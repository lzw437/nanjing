const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || "landscape-map";
const collectionName = "nanjing-landscape";
const wikiImageTitles = {
  "明孝陵": "明孝陵",
  "夫子庙秦淮风光带": "南京夫子庙",
  "中华门城堡": "中华门",
  "鸡鸣寺": "鸡鸣寺",
  "台城与南京城墙": "南京城墙",
  "瞻园": "瞻园",
  "朝天宫": "南京朝天宫",
  "栖霞寺": "栖霞寺",
  "灵谷寺": "灵谷寺",
  "总统府": "南京总统府",
  "阅江楼": "阅江楼",
  "挹江门": "挹江门",
  "美龄宫": "美龄宫",
  "中山陵": "中山陵",
  "甘熙故居": "甘熙故居",
  "大报恩寺遗址公园": "大报恩寺",
  "明故宫遗址": "明故宫",
  "鼓楼": "南京鼓楼",
  "玄武门": "玄武门 (南京)",
  "雨花台": "雨花台",
  "牛首山弘觉寺塔": "牛首山",
  "阳山碑材": "阳山碑材",
  "南唐二陵": "南唐二陵",
  "高淳老街": "高淳老街",
  "浦口火车站旧址": "浦口火车站",
  "梅园新村纪念馆": "梅园新村",
  "拉贝故居": "拉贝故居",
  "天生桥与胭脂河": "天生桥",
  "莫愁湖": "莫愁湖",
  "石头城": "石头城",
  "白鹭洲公园": "白鹭洲公园",
  "清凉山": "清凉山",
  "乌龙潭公园": "乌龙潭",
  "净觉寺": "净觉寺",
  "惠济寺": "惠济寺",
  "龙江宝船厂遗址": "龙江宝船厂",
  "永寿寺塔": "永寿寺塔",
  "七瓮瓮": "七瓮瓮",
  "仙林寺": "仙林寺",
  "江宁织造府": "江宁织造府",
  "玄武湖公园": "玄武湖",
  "南京博物院": "南京博物院",
  "南京长江大桥": "南京长江大桥",
  "颐和路民国公馆区": "颐和路",
  "老门东历史街区": "老门东",
  "燕子矶": "燕子矶",
  "紫金山天文台": "紫金山天文台",
  "九华山公园": "九华山_(南京)",
  "方山定林寺塔": "方山定林寺塔",
  "午朝门遗址公园": "午朝门公园",
  "郑和墓": "郑和墓"
};

if (!mongoUri) {
  throw new Error("Missing MONGODB_URI in .env");
}

function loadSpotsFromApp() {
  const appPath = path.join(__dirname, "app.js");
  const appCode = fs.readFileSync(appPath, "utf8");
  const endIndex = appCode.indexOf("const typeLabels");

  if (endIndex === -1) {
    throw new Error("Could not find spots data boundary in app.js");
  }

  const dataCode = `${appCode.slice(0, endIndex)}\nspots;`;
  return vm.runInNewContext(dataCode, {}, { filename: "app.js" });
}

async function seed() {
  const spots = loadSpotsFromApp().map((spot) => ({
    ...spot,
    wikiImageTitle: wikiImageTitles[spot.name] || spot.name,
    importedAt: new Date(),
    source: "app.js"
  }));

  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const collection = client.db(databaseName).collection(collectionName);
    await collection.createIndex({ id: 1 }, { unique: true });

    const operations = spots.map((spot) => ({
      updateOne: {
        filter: { id: spot.id },
        update: { $set: spot },
        upsert: true
      }
    }));

    const result = await collection.bulkWrite(operations, { ordered: false });

    console.log(`Seeded ${spots.length} landscapes into ${databaseName}.${collectionName}`);
    console.log({
      inserted: result.upsertedCount,
      matched: result.matchedCount,
      modified: result.modifiedCount
    });
  } finally {
    await client.close();
  }
}

seed().catch((error) => {
  console.error("Failed to seed landscapes:", error);
  process.exit(1);
});
