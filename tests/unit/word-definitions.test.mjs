import test from 'node:test';
import assert from 'node:assert/strict';
import {wordDefinitions} from '../../apps/server/src/word-definitions.js';
test('词典词义保留对应词性，处理粘连标签与后置标签',()=>{
 const d=wordDefinitions({meaningZh:'水',partOfSpeech:'n.'},{translation:'n. 水vt. 浇灌；给…饮水vi. 流泪，加水\n给…浇水 (v.)'});
 assert.deepEqual(d,[{partOfSpeech:'n.',meaningZh:'水'},{partOfSpeech:'vt.',meaningZh:'浇灌；给…饮水'},{partOfSpeech:'vi.',meaningZh:'流泪；加水'},{partOfSpeech:'v.',meaningZh:'给…浇水'}]);
 assert.deepEqual(wordDefinitions({meaningZh:'明亮的',partOfSpeech:'a.'},null),[{partOfSpeech:'adj.',meaningZh:'明亮的'}]);
 assert.deepEqual(wordDefinitions({meaningZh:'试验；尝试',partOfSpeech:'n./v.'},null),[{partOfSpeech:'n./v.',meaningZh:'试验；尝试'}]);
 assert.equal(wordDefinitions({meaningZh:'专有表达',partOfSpeech:''},null)[0].partOfSpeech,'词性未标注');
});
