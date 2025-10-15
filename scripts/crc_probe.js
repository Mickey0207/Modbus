function reflect8(b){ let out=0; for(let i=0;i<8;i++) out=(out<<1)|((b>>i)&1); return out&0xff }
function crc8(bytes, p){ let crc=p.init&0xff; for(let _b of bytes){ let b=_b; if(p.refin) b=reflect8(b); crc^=b; for(let i=0;i<8;i++) crc=(crc&0x80)?((crc<<1)^p.poly)&0xff: (crc<<1)&0xff } if(p.refout) crc=reflect8(crc); return (crc^p.xorout)&0xff }

const polys=[0x07,0x31,0x9B,0x1D,0x2F,0xD5,0x39];
const inits=[0x00,0xFF];
const xors=[0x00,0xFF,0x55];
const bool=[false,true];

function parseSample(s){ return s.split('-').map(x=>parseInt(x,16)); }
const samples=[
  "19-19-01-01-0F-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-24",
  "19-19-01-02-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-9C",
  "19-19-02-01-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-60",
  "19-19-02-02-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-C6"
].map(parseSample);

const prefixes = samples.map(arr=>arr.slice(0,-1));
const targets = samples.map(arr=>arr[arr.length-1]);

let matches=[];
for(const poly of polys){
 for(const init of inits){
  for(const refin of bool){
   for(const refout of bool){
    for(const xorout of xors){
      const p={poly,init,refin,refout,xorout};
      const ok = prefixes.every((pre,i)=> crc8(pre,p)===targets[i]);
      if(ok) matches.push(p);
    }
   }
  }
 }
}
console.log('matches', matches);

// Also print CRC for a few candidates
const candidates=[
  {name:'STD', poly:0x07, init:0x00, refin:false, refout:false, xorout:0x00},
  {name:'MAXIM', poly:0x31, init:0x00, refin:true, refout:true, xorout:0x00},
  {name:'ITU', poly:0x07, init:0x00, refin:false, refout:false, xorout:0x55},
  {name:'ROHC', poly:0x07, init:0xFF, refin:true, refout:true, xorout:0x00},
  {name:'AUTOSAR', poly:0x2F, init:0xFF, refin:false, refout:false, xorout:0xFF},
  {name:'DVB-S2', poly:0xD5, init:0x00, refin:false, refout:false, xorout:0x00},
  {name:'CDMA2000', poly:0x9B, init:0xFF, refin:false, refout:false, xorout:0x00},
  {name:'DARC', poly:0x39, init:0x00, refin:true, refout:true, xorout:0x00},
  {name:'EBU', poly:0x1D, init:0xFF, refin:true, refout:true, xorout:0x00},
  {name:'SAE-J1850', poly:0x1D, init:0xFF, refin:false, refout:false, xorout:0xFF}
];
for(const c of candidates){
  const p=c; const list=prefixes.map(pre=>crc8(pre,p));
  console.log(c.name, list.map(x=>x.toString(16).padStart(2,'0')).join(' '));
}
