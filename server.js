const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || "landscape-map";
const collectionName = process.env.SIGN_IN_COLLECTION || "sign in";
const tokenSecret = process.env.TOKEN_SECRET || "dev-secret";

if (!mongoUri) {
  console.warn("MONGODB_URI not set; DB features disabled");
}

const client = new MongoClient(mongoUri);
let usersCollection;
let interactionsCollection;
let commentsCollection;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "32kb" }));
app.use(express.static(__dirname));

// Add lazy-connect middleware
app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api/") || !mongoUri) return next();
  try {
    await ensureDb();
  } catch (err) {
    console.error("DB connection error:", err);
  }
  next();
});
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || "").trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const passwordHash = crypto
    .pbkdf2Sync(String(password), salt, 120000, 64, "sha512")
    .toString("hex");
  return { salt, passwordHash };
}

function verifyPassword(password, user) {
  const { passwordHash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(passwordHash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: String(user._id),
    username: user.username,
    email: user.email,
    exp: Date.now() + 1000 * 60 * 60 * 24
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", tokenSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function publicUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    email: user.email,
    createdAt: user.createdAt
  };
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "请先登录。" });
    }

    const token = authHeader.slice(7);
    const [payloadB64] = token.split(".");
    
    let payload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    } catch {
      return res.status(401).json({ message: "无效的令牌。" });
    }

    if (!payload.sub || Date.now() > payload.exp) {
      return res.status(401).json({ message: "登录已过期，请重新登录。" });
    }

    let userId;
    try {
      userId = new ObjectId(payload.sub);
    } catch {
      return res.status(401).json({ message: "无效的用户 ID。" });
    }

    const user = await usersCollection.findOne({ _id: userId });
    if (!user) {
      return res.status(401).json({ message: "用户不存在。" });
    }

    req.user = publicUser(user);
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "验证失败。" });
  }
}

function validateRegister(body) {
  const username = normalizeUsername(body.username);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");

  if (username.length < 2 || username.length > 24) {
    return { error: "用户名长度需要在 2-24 个字符之间。" };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "请输入正确的邮箱地址。" };
  }

  if (password.length < 6) {
    return { error: "密码至少需要 6 位。" };
  }

  return { username, email, password };
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const data = validateRegister(req.body);
    if (data.error) return res.status(400).json({ message: data.error });

    const exists = await usersCollection.findOne({
      $or: [{ email: data.email }, { username: data.username }]
    });

    if (exists) {
      return res.status(409).json({ message: "用户名或邮箱已经注册。" });
    }

    const { salt, passwordHash } = hashPassword(data.password);
    const now = new Date();
    const user = {
      username: data.username,
      email: data.email,
      salt,
      passwordHash,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now
    };

    const result = await usersCollection.insertOne(user);
    user._id = result.insertedId;

    res.status(201).json({
      message: "注册成功。",
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "注册失败，请稍后重试。" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const account = String(req.body.account || "").trim();
    const password = String(req.body.password || "");

    if (!account || !password) {
      return res.status(400).json({ message: "请输入账号和密码。" });
    }

    const user = await usersCollection.findOne({
      $or: [{ email: normalizeEmail(account) }, { username: account }]
    });

    if (!user || !verifyPassword(password, user)) {
      return res.status(401).json({ message: "账号或密码错误。" });
    }

    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: new Date(), updatedAt: new Date() } }
    );

    res.json({
      message: "登录成功。",
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "登录失败，请稍后重试。" });
  }
});

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    database: databaseName,
    collection: collectionName
  });
});

app.get("/api/interactions/:spotId", async (req, res) => {
  try {
    const spotId = req.params.spotId;
    
    const interaction = await interactionsCollection.findOne({ spotId });
    const comments = await commentsCollection
      .find({ spotId })
      .sort({ createdAtTimestamp: -1 })
      .toArray();
    
    res.json({
      spotId,
      likes: interaction?.likes || [],
      comments: comments.map(c => ({
        id: String(c._id),
        userId: c.userId,
        username: c.username,
        content: c.content,
        createdAt: c.createdAt
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "获取互动数据失败" });
  }
});

app.post("/api/interactions/:spotId/like", async (req, res) => {
  try {
    const spotId = req.params.spotId;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: "用户 ID 不能为空" });
    }
    
    const interaction = await interactionsCollection.findOne({ spotId });
    
    if (!interaction) {
      await interactionsCollection.insertOne({
        spotId,
        likes: [userId],
        comments: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return res.json({ message: "点赞成功", liked: true });
    }
    
    if (interaction.likes.includes(userId)) {
      return res.status(409).json({ message: "已经点过赞了" });
    }
    
    await interactionsCollection.updateOne(
      { spotId },
      { 
        $push: { likes: userId },
        $set: { updatedAt: new Date() }
      }
    );
    
    res.json({ message: "点赞成功", liked: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "点赞失败" });
  }
});

app.delete("/api/interactions/:spotId/like", async (req, res) => {
  try {
    const spotId = req.params.spotId;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: "用户 ID 不能为空" });
    }
    
    const interaction = await interactionsCollection.findOne({ spotId });
    
    if (!interaction || !interaction.likes.includes(userId)) {
      return res.status(404).json({ message: "未找到点赞记录" });
    }
    
    await interactionsCollection.updateOne(
      { spotId },
      { 
        $pull: { likes: userId },
        $set: { updatedAt: new Date() }
      }
    );
    
    res.json({ message: "取消点赞成功", liked: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "取消点赞失败" });
  }
});

app.post("/api/comments", requireAuth, async (req, res) => {
  try {
    const { spotId, content } = req.body;
    const user = req.user;
    
    if (!spotId || !content.trim()) {
      return res.status(400).json({ message: "景点 ID 和评论内容不能为空" });
    }
    
    const comment = {
      spotId,
      userId: user.id,
      username: user.username,
      content: content.trim(),
      createdAt: new Date().toLocaleString("zh-CN"),
      createdAtTimestamp: new Date()
    };
    
    const result = await commentsCollection.insertOne(comment);
    
    res.status(201).json({ 
      message: "评论成功", 
      comment: {
        id: String(result.insertedId),
        ...comment
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "评论失败" });
  }
});

app.delete("/api/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const commentId = req.params.commentId;
    const user = req.user;
    
    let objectId;
    try {
      objectId = new ObjectId(commentId);
    } catch {
      return res.status(400).json({ message: "无效的评论 ID" });
    }
    
    const comment = await commentsCollection.findOne({ _id: objectId });
    
    if (!comment) {
      return res.status(404).json({ message: "未找到评论" });
    }
    
    if (comment.userId !== user.id) {
      return res.status(403).json({ message: "无权删除此评论" });
    }
    
    await commentsCollection.deleteOne({ _id: objectId });
    
    res.json({ message: "删除评论成功" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "删除评论失败" });
  }
});

async function ensureDb() {
  if (usersCollection) return;
  await client.connect();
  const db = client.db(databaseName);
  usersCollection = db.collection(collectionName);
  interactionsCollection = db.collection("interactions");
  commentsCollection = db.collection("comment");
  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await usersCollection.createIndex({ username: 1 }, { unique: true });
  await interactionsCollection.createIndex({ spotId: 1 }, { unique: true });
  await commentsCollection.createIndex({ spotId: 1 });
  await commentsCollection.createIndex({ userId: 1 });
}

// Vercel version: always export
if (false) {
  async function start() {
    try {
      await ensureDb();
    } catch (err) {
      console.error("MongoDB connection failed:", err);
    }
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
      console.log(`MongoDB collection: ${databaseName}.${collectionName}`);
    });
  }
  start().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
} else {
  module.exports = { app, ensureDb };
}
