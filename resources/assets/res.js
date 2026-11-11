document.addEventListener('click',function(e){var b=e.target.closest('.cp');if(!b)return;var t=b.closest('.pr').querySelector('pre').innerText;
 var done=function(){var l=b.textContent;b.textContent='Copied';b.classList.add('ok');setTimeout(function(){b.textContent=l;b.classList.remove('ok')},1600)};
 if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(done,function(){leg(t);done()})}else{leg(t);done()}});
function leg(t){var a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy')}catch(x){}a.remove()}
(function(){var o=document.getElementById('cust');if(!o)return;var ids=['su','sh','bk','cl'];
 function n(i){var v=parseFloat((document.getElementById(i).value||'').replace(/[,%\s]/g,''));return isNaN(v)?null:v}
 function run(){var a=ids.map(n);if(a.some(function(v){return v===null})){o.textContent='';return}
  var c=a[0]*(a[1]/100)*(a[2]/100)*(a[3]/100);o.textContent=(c>=10?Math.round(c):Math.round(c*10)/10).toLocaleString('en-US')}
 ids.forEach(function(i){document.getElementById(i).addEventListener('input',run)});run()})();
(function(){var t=document.getElementById('msg');if(!t)return;var L=[['WhatsApp',400,'c'],['LinkedIn note',300,'c'],['SMS',160,'c'],['Subject line',8,'w']];
 var r=document.getElementById('msgr');function run(){var s=t.value,c=s.length,w=(s.trim().match(/\S+/g)||[]).length;r.innerHTML='';
  var h=document.createElement('span');h.textContent=c+(c==1?' character, ':' characters, ')+w+(w==1?' word':' words');r.appendChild(h);if(!c)return;
  L.forEach(function(x){var v=x[2]==='c'?c:w,ok=v<x[1],e=document.createElement('span');e.className=ok?'ok':'no';
   e.textContent=x[0]+': '+(ok?'fits':'over by '+(v-x[1]+1));r.appendChild(e)})}
 t.addEventListener('input',run);run()})();
