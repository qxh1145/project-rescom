import puppeteer from 'puppeteer-core';
import fs from 'fs';
const exe='/Users/quan/.cache/puppeteer/chrome/mac_arm-152.0.7977.42/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const b=await puppeteer.launch({executablePath:exe,headless:true,args:['--allow-file-access-from-files']});
const p=await b.newPage(); await p.setViewport({width:1920,height:1080,deviceScaleFactor:1});
await p.goto('file://'+process.cwd()+'/comp.html',{waitUntil:'networkidle0'}); await p.evaluate(()=>window.ready);
const mode=process.argv[2];
if(mode==='stills'){ fs.mkdirSync('stills',{recursive:true});
  for(const t of process.argv.slice(3).map(Number)){await p.evaluate(t=>render(t),t); await p.screenshot({path:`stills/t${t.toFixed(2)}.jpg`,type:'jpeg',quality:80});}
} else { fs.mkdirSync('frames',{recursive:true}); const N=21*30;
  for(let i=0;i<N;i++){await p.evaluate(t=>render(t),i/30); await p.screenshot({path:`frames/f${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:93});}
}
await b.close();
