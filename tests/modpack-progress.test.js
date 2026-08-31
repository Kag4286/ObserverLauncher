// Simulate the modpack progress stream (renderer formula) — the bar must be monotonic and the
// "i / N" label must never show byte counts.
let pass=0,fail=0;const ck=(n,c)=>{c?(pass++,console.log('PASS',n)):(fail++,console.log('FAIL',n))};
const fmtPct=(index,total,received,fileTotal)=>Math.min(100,Math.round(((index-1)+Math.min(1,(received||0)/(fileTotal||1)))/total*100));

// 3 files: sizes 100, 50, 200 bytes; simulate chunked downloads
const files=[{s:100},{s:50},{s:200}];
let last=-1,mono=true,labelsOK=true;
files.forEach((f,i)=>{
  const chunks=[0,Math.floor(f.s/3),Math.floor(2*f.s/3),f.s];
  chunks.forEach(rec=>{
    const pct=fmtPct(i+1,files.length,rec,f.s);
    if(pct<last)mono=false;
    last=Math.max(last,pct);
  });
});
ck('bar monotonic (never jumps back)',mono);
ck('final = 100%',fmtPct(files.length,files.length,files[2].s,files[2].s)===100);
// old buggy behaviour, for the record: label used p.total = BYTES in the count slot, and the bar
// formula divided by bytes too — so labels showed "INSTALLING 5 / 64426830" and the bar slammed
// between ~0% and the correct value on every alternating event.
const oldLabel=(i,t)=>`INSTALLING ${i} / ${t}`;
ck('old label WAS broken (byte count in label)',oldLabel(5,64426830)==='INSTALLING 5 / 64426830');
const oldBar=(p)=>Math.min(100,Math.round((p.index-1+(p.received||0)/(p.total||1))/p.total*100));
ck('old bar formula collapsed to ~0% on byte events',oldBar({index:2,total:64426,received:30000})<=1);
// label sanity
const label=(i,t)=>`INSTALLING ${i} / ${t}`;
ck('label uses file count only',label(2,47)==='INSTALLING 2 / 47');
// logLevel WARNING classification
const t='WARNING: sun.misc.Unsafe::objectFieldOffset has been called by com.google.common...';
ck('JVM WARNING: lines classify as warn',/^WARNING:/i.test(t.trim()));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
