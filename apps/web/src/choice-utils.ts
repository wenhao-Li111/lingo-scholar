type ChoiceWord={id:string;lemma:string;meaningZh:string;meaningDisplay?:string;partOfSpeech:string;acceptedSpellings?:string[]};
export function hash(value:string){let n=2166136261;for(const c of value)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
const meanings=(s:string)=>s.replace(/\b(?:n|v|vt|vi|adj|adv)\./g,'').split(/[；;，,\n]/).map(x=>x.trim()).filter(Boolean);
export function meaningChoices(word:ChoiceWord,pool:ChoiceWord[]){
 const synonyms=new Set(meanings(word.meaningZh));const spellings=new Set([word.lemma,...word.acceptedSpellings||[]].map(s=>s.toLowerCase()));
 const unique=new Set([word.meaningZh]);
 const others=pool.filter(w=>!spellings.has(w.lemma.toLowerCase())&&!meanings(w.meaningZh).some(m=>synonyms.has(m)))
 .sort((a,b)=>(Number(b.partOfSpeech===word.partOfSpeech)-Number(a.partOfSpeech===word.partOfSpeech))||hash(word.id+a.id)-hash(word.id+b.id))
 .filter(w=>{if(!w.meaningZh||unique.has(w.meaningZh))return false;unique.add(w.meaningZh);return true;}).slice(0,3);
 return [...others,word].sort((a,b)=>hash(word.id+':option:'+a.id)-hash(word.id+':option:'+b.id));
}
