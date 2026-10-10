const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync('../src/app.js','utf8'),c=vm.createContext({});vm.runInContext(s.slice(s.indexOf('function logoFit'),s.indexOf('function applyLogoBacking')),c);
const p=new Uint8ClampedArray(24*24*4);for(let i=3;i<p.length;i+=4)p[i]=255;
assert.equal(c.logoFit(p,180,180),'tile');assert.equal(c.logoFit(p,240,120),'inset');assert.equal(c.logoFit(new Uint8ClampedArray(p.length),180,180),'inset');
for(let x=0;x<24;x++)p[x*4+3]=0;assert.equal(c.logoFit(p,180,180),'inset');
const css=fs.readFileSync('../src/layout.css','utf8');assert.match(css,/\.ico \{[^}]*overflow:hidden/);assert.match(css,/\[data-logo-fit="tile"\] \.fav \{ width:100%; height:100%; border-radius:inherit; \}/);
console.log('PASS: opaque square tiles fill unified rounded mask; transparent/non-square logos remain inset.');
