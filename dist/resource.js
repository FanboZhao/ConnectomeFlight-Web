// Bounded, cancellable loading shared by scene data and display images.
export function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const clean=()=>signal.removeEventListener('abort',aborted);
    const aborted = () => {clean();reject(signal.reason || new DOMException('加载已取消', 'AbortError'));};
    promise.then(value=>{clean();resolve(value);},error=>{clean();reject(error);});
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, {once:true});
  });
}

export async function fetchResource(url, {signal, kind='json', onProgress=()=>{}}={}) {
  for (let attempt=0; attempt<3; attempt++) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) throw signal.reason || new DOMException('加载已取消','AbortError');
    signal?.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(() => controller.abort(new DOMException('资源加载超时','TimeoutError')), 25000);
    try {
      const response = await fetch(url, {signal:controller.signal});
      if (!response.ok) {
        const error = new Error(`资源暂不可用（${response.status}）`);
        error.permanent = response.status>=400 && response.status<500 && ![408,429].includes(response.status);
        throw error;
      }
      const total = Number(response.headers.get('Content-Length'));
      let blob;
      if (response.body?.getReader) {
        const reader=response.body.getReader(), chunks=[];
        let received=0;
        for (;;) {
          const {done,value}=await reader.read();
          if (done) break;
          chunks.push(value); received+=value.byteLength; onProgress(received,total);
        }
        blob=new Blob(chunks,{type:response.headers.get('Content-Type')||''});
      } else blob=await response.blob();
      return kind==='json' ? JSON.parse(await blob.text()) : blob;
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      if (error.permanent || attempt===2) {
        const failure=new Error(`${new URL(url,location.href).pathname.split('/').pop()}：${error.message}`);
        failure.name=controller.signal.reason?.name || error.name;
        throw failure;
      }
      onProgress(0,0,attempt+1);
      await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort',abort);
    }
  }
}

export async function loadImage(url, signal) {
  const blob=await fetchResource(url,{signal,kind:'blob'});
  const image=new Image(), objectURL=URL.createObjectURL(blob);
  try {
    image.src=objectURL;
    await abortable(image.decode(),signal);
    return image;
  } catch (error) { image.src=''; throw error; }
  finally { URL.revokeObjectURL(objectURL); }
}
