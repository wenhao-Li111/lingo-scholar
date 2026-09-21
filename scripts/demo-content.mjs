/** Original miniature demonstration dataset. Never overwrites a user's imported vocabulary. */
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','content/resources/supplemental');
const rows=[
 ['habitat','n.','栖息地','ˈhæbɪtæt','The wetland is a habitat for many birds.','这片湿地是许多鸟类的栖息地。'],
 ['evidence','n.','证据；依据','ˈevɪdəns','The report presents evidence of cleaner air.','这份报告提供了空气变得更清洁的证据。'],
 ['resource','n.','资源；资料','rɪˈzɔːs','Water is a resource that we must protect.','水是我们必须保护的资源。'],
 ['survey','n.','调查；测量','ˈsɜːveɪ','Our survey asks students about travel.','我们的调查询问学生的出行情况。'],
 ['benefit','n.','好处；益处','ˈbenɪfɪt','One benefit of cycling is better health.','骑自行车的一个好处是身体更健康。'],
 ['method','n.','方法；办法','ˈmeθəd','This method makes revision easier.','这种方法让复习更容易。'],
 ['factor','n.','因素；因子','ˈfæktə','Cost is an important factor in our choice.','成本是影响我们选择的重要因素。'],
 ['policy','n.','政策；方针','ˈpɒləsi','The new policy supports public transport.','这项新政策支持公共交通。'],
 ['species','n.','物种','ˈspiːʃiːz','Each species needs a suitable environment.','每个物种都需要适宜的环境。'],
 ['climate','n.','气候','ˈklaɪmət','The local climate is warm and wet.','当地气候温暖潮湿。'],
 ['income','n.','收入；收益','ˈɪnkʌm','Her income covers the cost of the course.','她的收入足以支付课程费用。'],
 ['budget','n.','预算','ˈbʌdʒɪt','We have a small budget for the experiment.','我们这次实验的预算很少。'],
 ['device','n.','装置；设备','dɪˈvaɪs','This device measures room temperature.','这台设备测量室温。'],
 ['pattern','n.','模式；图案','ˈpætən','The chart shows a clear pattern.','这张图表显示出一个清晰的规律。'],
 ['demand','n.','需求；要求','dɪˈmɑːnd','There is growing demand for quiet study spaces.','人们对安静学习空间的需求不断增长。'],
 ['supply','n.','供应；供给','səˈplaɪ','The village needs a reliable water supply.','这个村庄需要可靠的供水。'],
 ['research','n.','研究；调查','rɪˈsɜːtʃ','Their research focuses on urban gardens.','他们的研究关注城市花园。'],
 ['community','n.','社区；群体','kəˈmjuːnəti','The community opened a shared library.','社区开设了一间共享图书馆。'],
 ['transport','n.','交通；运输','ˈtrænspɔːt','Public transport connects the two towns.','公共交通连接了这两个城镇。'],
 ['environment','n.','环境','ɪnˈvaɪrənmənt','A quiet environment helps me concentrate.','安静的环境有助于我集中注意力。'],
 ['improve','v.','改善；提高','ɪmˈpruːv','Daily practice can improve your listening.','每天练习可以提高你的听力。'],
 ['reduce','v.','减少；降低','rɪˈdjuːs','We can reduce waste by repairing things.','我们可以通过修理物品减少浪费。'],
 ['increase','v.','增加；提高','ɪnˈkriːs','More buses could increase access to the campus.','更多公交车可以让人们更方便地到达校园。'],
 ['compare','v.','比较；对照','kəmˈpeə','Compare the two charts before writing.','写作前先比较这两张图表。'],
 ['explain','v.','解释；说明','ɪkˈspleɪn','Please explain the purpose of this study.','请解释这项研究的目的。'],
 ['develop','v.','发展；开发','dɪˈveləp','Students develop confidence through practice.','学生通过练习培养自信。'],
 ['protect','v.','保护；防护','prəˈtekt','These rules protect the lake from pollution.','这些规定保护湖泊免受污染。'],
 ['support','v.','支持；支撑','səˈpɔːt','The results support our original idea.','这些结果支持我们最初的想法。'],
 ['observe','v.','观察；遵守','əbˈzɜːv','We observe the plants every morning.','我们每天早晨观察这些植物。'],
 ['adapt','v.','适应；改编','əˈdæpt','People adapt to changes in their routine.','人们会适应日常生活中的变化。'],
 ['efficient','adj.','高效的','ɪˈfɪʃənt','An efficient system saves time and energy.','高效的系统节省时间和能源。'],
 ['reliable','adj.','可靠的','rɪˈlaɪəbl','We need reliable information for our report.','我们需要可靠的信息来撰写报告。'],
 ['accurate','adj.','准确的','ˈækjərət','An accurate map helps visitors find the museum.','准确的地图帮助游客找到博物馆。'],
 ['significant','adj.','显著的；重要的','sɪɡˈnɪfɪkənt','There was a significant change in attendance.','出勤人数发生了显著变化。'],
 ['available','adj.','可获得的；有空的','əˈveɪləbl','Several rooms are available this afternoon.','今天下午有几间房可用。'],
 ['sustainable','adj.','可持续的','səˈsteɪnəbl','The team is planning a sustainable transport system.','团队正在规划可持续的交通系统。'],
 ['gradually','adv.','逐渐地','ˈɡrædʒuəli','The number of visitors grew gradually.','游客数量逐渐增加。'],
 ['frequently','adv.','频繁地；经常','ˈfriːkwəntli','This word appears frequently in reports.','这个词经常出现在报告中。'],
 ['approximately','adv.','大约；近似地','əˈprɒksɪmətli','The journey takes approximately one hour.','这段旅程大约需要一小时。'],
 ['independently','adv.','独立地','ˌɪndɪˈpendəntli','She completed the project independently.','她独立完成了这个项目。'],
];
mkdirSync(root,{recursive:true});
const file=path.join(root,'decks.json');
if(existsSync(file)){console.log('Existing vocabulary preserved; demo import skipped.');process.exit(0);}
const words=rows.map(([lemma,partOfSpeech,meaningZh,phonetic,example,exampleZh],i)=>({id:`demo-${i+1}`,lemma,partOfSpeech,meaningZh,phonetic,example,exampleZh,exampleSource:'Lingo Scholar 原创演示',group:Math.floor(i/20)+1}));
writeFileSync(file,JSON.stringify({decks:[{id:'demo-original',title:'原创演示 · 学术与生活',shortTitle:'原创演示',description:'40 个演示词；不等同完整雅思词库',wordCount:words.length,groupSize:20,words}]},null,2));
console.log('Created 40 original demonstration entries; no third-party textbooks or audio included.');
