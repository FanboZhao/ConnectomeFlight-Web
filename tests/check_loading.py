"""Browser regressions for scene synchronization and bounded failure recovery."""
import json
import os
from pathlib import Path
import sys
import threading
import time
from http.server import ThreadingHTTPServer

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from serve import Handler
from PIL import Image
from playwright.sync_api import sync_playwright

FAST_CLOCK = """const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,({90000:1500,30000:1000,25000:400,500:30,1000:60})[ms]??ms,...args);"""
CANVAS_LIMIT = """const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){if(this.width>4096||this.height>4096)throw Error('Canvas exceeds mobile bounds');return original.apply(this,args);};"""


class TestHandler(Handler):
    slow_path = None
    slow_requests = 0

    def copyfile(self, source, output):
        if not self.slow_path or not self.path.startswith(self.slow_path):
            return super().copyfile(source, output)
        type(self).slow_requests += 1
        try:
            while self.remaining:
                chunk = source.read(min(16384, self.remaining))
                if not chunk:
                    break
                output.write(chunk)
                output.flush()
                self.remaining -= len(chunk)
                time.sleep(.12)
        except (BrokenPipeError, ConnectionResetError):
            pass


def wait_ready(page):
    page.locator('#loading').wait_for(state='hidden', timeout=15000)
    assert page.locator('#retry-load').is_hidden()


def seek(page, frame):
    page.locator('#timeline').evaluate('(el,f)=>{el.value=f;el.dispatchEvent(new Event("input"));}', frame)
    page.wait_for_function('(f)=>Number(document.querySelector("#frame-label").textContent.split("/")[0])===f+1', arg=frame, timeout=15000)


def verify_eye(page, scene, image, frame):
    size = scene['sensorOffsets']['eyeSize']
    width = scene['networkLayout']['imageWidth']
    columns = width // size
    for eye, name in enumerate(['eye-left', 'eye-right']):
        tile = frame * 2 + eye
        x = tile % columns * size
        y = scene['networkLayout']['rowsPerFrame'] * scene['frames'] + tile // columns * size
        expected = image.crop((x,y,x+size,y+size)).tobytes()
        actual = bytes(page.locator('#'+name).evaluate('(c)=>Array.from(c.getContext("2d").getImageData(0,0,c.width,c.height).data)'))
        assert actual == expected, f'Binocular frame mismatch: {name} frame {frame}'


def main():
    server = ThreadingHTTPServer(('127.0.0.1',0), TestHandler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    checks = []
    with sync_playwright() as pw:
        options = {'headless':True}
        if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'):
            options['executable_path'] = os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH']
        browser = pw.chromium.launch(**options)
        for task in ['d3','d4']:
            for variant in [1,2,3]:
                stem = task + (f'-{variant}' if variant>1 else '')
                scene = json.loads((ROOT/f'dist/media/{stem}-display.json').read_text())
                image = Image.open(ROOT/f'dist/media/{stem}-appearance.png').convert('RGBA')
                context = browser.new_context(viewport={'width':1440,'height':900})
                page = context.new_page(); errors=[]; requests=[]
                page.on('pageerror',lambda e: errors.append(str(e)))
                page.on('request',lambda r:requests.append(r.url))
                page.add_init_script(CANVAS_LIMIT)
                page.goto(f'{base}?task={task.upper()}&scene={variant}')
                wait_ready(page)
                assert not any('-appearance.png' in u for u in requests)
                for frame in [0,7,8,15,16,31,64,scene['frames']-1,0]:
                    seek(page,frame); verify_eye(page,scene,image,frame)
                seek(page,14)
                page.click('#play-button')
                page.wait_for_function('()=>Number(document.querySelector("#frame-label").textContent.split("/")[0])>35',timeout=15000)
                page.click('#play-button')
                assert not errors, errors
                context.close(); checks.append(stem+' seek / eyes / cross-segment playback')

        def fault(name, route_pattern=None, handler=None, init=FAST_CLOCK, query=''):
            context=browser.new_context(viewport={'width':1440,'height':900})
            page=context.new_page(); errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            if init:page.add_init_script(init)
            if handler:page.route(route_pattern,handler)
            page.goto(base+query)
            return context,page,errors

        attempts=[]
        TestHandler.slow_path='/media/d3-activity-0000.png'
        context,page,errors=fault('slow-progress')
        wait_ready(page);assert not errors;assert TestHandler.slow_requests==1
        context.close();TestHandler.slow_path=None
        checks.append('slow progressing transfer finishes without being discarded')

        def transient(route):
            attempts.append(route.request.url)
            if len(attempts)==1:route.fulfill(status=503,body='Try again')
            else:route.continue_()
        context,page,errors=fault('retry','**/d3-display.json?*',transient)
        wait_ready(page);assert len(attempts)==2;assert not errors
        context.close();checks.append('transient JSON retry')

        attempts.clear()
        context,page,errors=fault('chunk-retry','**/d3-activity-0016.png?*',transient)
        wait_ready(page);seek(page,16);assert len(attempts)==2;assert not errors
        context.close();checks.append('transient segment retry')

        context,page,errors=fault('module','**/app.js?*',lambda r:r.abort())
        page.locator('#retry-load').wait_for(state='visible');assert page.locator('#playback-status').inner_text()=='加载失败'
        page.unroute('**/app.js?*');page.click('#retry-load');wait_ready(page)
        context.close();checks.append('module failure and retry reload')

        context,page,errors=fault('missing','**/d3-activity-0000.png?*',lambda r:r.fulfill(status=404,body='missing'))
        page.locator('#retry-load').wait_for(state='visible');assert page.locator('#playback-status').inner_text()=='加载失败'
        page.unroute('**/d3-activity-0000.png?*');page.click('#retry-load');wait_ready(page)
        context.close();checks.append('missing segment and in-page recovery')

        held=[]
        context,page,errors=fault('hanging','**/d3-activity-0000.png?*',lambda r:held.append(r))
        page.locator('#retry-load').wait_for(state='visible');assert page.locator('#playback-status').inner_text()=='加载失败'
        for route in held:
            try:route.abort()
            except Exception:pass
        context.close();checks.append('hanging essential request deadline')

        held=[]
        context,page,errors=fault('odor','**/odor-field.png?*',lambda r:held.append(r),query='?task=D4')
        wait_ready(page);page.wait_for_timeout(1700)
        assert page.locator('#loading').is_hidden();assert not errors
        for route in held:
            try:route.abort()
            except Exception:pass
        context.close();checks.append('hanging optional odor background remains usable')

        init=CANVAS_LIMIT+"Object.hasOwn=undefined;HTMLVideoElement.prototype.addEventListener=new Proxy(HTMLVideoElement.prototype.addEventListener,{apply(fn,self,args){if(args[0]==='loadeddata')return;return Reflect.apply(fn,self,args);}});"
        context,page,errors=fault('compatibility',init=init)
        wait_ready(page);assert not errors
        page.select_option('#quality','hd');wait_ready(page)
        page.wait_for_function('()=>document.querySelector("video").videoWidth===2560')
        context.close();checks.append('missing loadeddata / hasOwn and HD switch')

        context,page,errors=fault('rapid-switch',init=CANVAS_LIMIT)
        wait_ready(page)
        page.evaluate('()=>{document.querySelector("[data-difficulty=D4]").click();document.querySelectorAll("[data-scene]")[2].click();document.querySelector("[data-difficulty=D3]").click();}')
        wait_ready(page);assert not errors
        assert 'task=D3' in page.url
        context.close();checks.append('rapid scene cancellation')
        browser.close()
    server.shutdown()
    print(json.dumps({'status':'PASS','checks':checks},ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
