// Keep this entry independent of module downloads so startup failures are visible.
(function () {
  var started=false;
  var retry=document.getElementById('retry-load');
  function failed(message) {
    if(started)return;
    document.getElementById('playback-status').textContent='加载失败';
    document.querySelector('.top-status').dataset.state='error';
    document.getElementById('loading-message').textContent='页面启动失败，请重新加载。';
    document.getElementById('loading-hint').textContent=message;
    document.getElementById('loading').classList.add('load-failed');
    document.getElementById('flight-panel').setAttribute('aria-busy','false');
    retry.hidden=false;
  }
  function reload(){if(!started)location.reload();}
  retry.addEventListener('click',reload);
  var timer=setTimeout(function(){failed('连接时间较长，请检查网络后重新加载页面。');},30000);
  import('./app.js?v=network-fill-20261119').then(function(){
    started=true;clearTimeout(timer);retry.removeEventListener('click',reload);
    document.getElementById('startup-retry').hidden=true;
  }).catch(function(error){
    clearTimeout(timer);console.error('ConnectomeFlight startup:',error);
    failed(navigator.onLine===false?'当前离线，请连接网络后重试。':'页面组件未能载入，请重新加载页面。');
  });
})();
