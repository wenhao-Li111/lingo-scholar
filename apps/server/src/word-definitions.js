// Keep each dictionary sense attached to its part of speech; never infer a single
// part of speech for an ambiguous multi-POS source entry.
const POS='(?:vt|vi|adj|adv|prep|pron|conj|interj|aux|det|num|art|n|v|a|ad)';
const normalize=p=>p.replace(/\ba\./g,'adj.').replace(/\bad\./g,'adv.').replace(/\s+/g,'').replace(/\.$/,'')+'.';
export function wordDefinitions(word,dictionary){
 const groups=new Map();
 const add=(pos,text)=>{
  const key=pos?normalize(pos):'词性未标注';
  const values=groups.get(key)||new Set();
  for(const sense of text.split(/[；;，,\n]/).map(s=>s.trim()).filter(s=>/[\p{L}\p{N}]/u.test(s)))values.add(sense);
  if(values.size)groups.set(key,values);
 };
 const parse=(text,fallback)=>{
  text=String(text||'').split(/【记忆】|【词根】|【搭配】/)[0].trim();
  const suffix=text.match(new RegExp(`\\(\\s*(${POS}\\.)\\s*\\)$`));
  if(suffix){add(suffix[1],text.slice(0,suffix.index));return;}
  const labels=[...text.matchAll(new RegExp(`\\b(${POS}\\.(?:\\s*[/&]\\s*${POS}\\.)*)\\s*`,'g'))];
  if(!labels.length){add(fallback,text);return;}
  if(labels[0].index>0)add(fallback,text.slice(0,labels[0].index));
  labels.forEach((m,i)=>add(m[1],text.slice(m.index+m[0].length,labels[i+1]?.index??text.length)));
 };
 for(const line of (dictionary?.translation||'').split('\n'))if(line.trim().length>1&&!/^\s*\[|人名/.test(line))parse(line,'');
 // Source meanings already classified by the dictionary need not be repeated
 // under a broad "n./v." label. Keep unmatched meanings with the source label.
 const known=new Set([...groups.values()].flatMap(s=>[...s]));
 const source=String(word.meaningZh||'').split(/[；;，,\n]/).filter(s=>!known.has(s.trim())).join('；');
 if(source)parse(source,word.partOfSpeech);
 if(groups.size>1&&groups.has('词性未标注')){
  const classified=new Set([...groups.entries()].filter(([p])=>p!=='词性未标注').flatMap(([,s])=>[...s]));
  const unclassified=new Set([...groups.get('词性未标注')].filter(s=>!classified.has(s)));
  if(unclassified.size)groups.set('词性未标注',unclassified);else groups.delete('词性未标注');
 }
 return [...groups].map(([partOfSpeech,senses])=>({partOfSpeech,meaningZh:[...senses].join('；')}));
}
