const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");

require('dotenv').config();
const token = process.env.TELEGRAM_BOT_TOKEN; // Load token from .env file
const bot = new TelegramBot(token, { polling: true });

const userStates = {};
const scheduledPosts = [];
const allowedAdmins = {}; // chatId -> Set of usernames
let superAdminId = null;
let superAdminUsername = null;

console.log("Bot is running...");

// --- COMMAND HANDLERS ---
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from?.username;
  const userId = msg.from?.id;

  console.log(`[START] User ${username || 'Unknown'} (ID: ${userId}) started the bot`);

  if (!superAdminId) {
    superAdminId = userId;
    superAdminUsername = username;
    bot.sendMessage(chatId, "✅ You are now registered as the super admin.");
    bot.sendMessage(
      msg.chat.id,
      `📌 Commands:
/start - Start bot
/help - Show help
/whoami - Show your info
/newpost - Schedule a post
/viewposts - List scheduled posts
/addadmin <username> - Request to add a new admin`
    );
  } else {
    bot.sendMessage(chatId, "👋 Welcome! Use /newpost to schedule a post.");
    bot.sendMessage(
      msg.chat.id,
      `📌 Commands:
/start - Start bot
/help - Show help
/whoami - Show your info
/newpost - Schedule a post
/viewposts - List scheduled posts
/addadmin <username> - Request to add a new admin`
    );
  }
});

bot.onText(/\/help/, (msg) => {
  console.log(`[HELP] User ${msg.from?.username} requested help`);
  bot.sendMessage(
    msg.chat.id,
    `📌 Commands:
/start - Start bot
/help - Show help
/newpost - Schedule a post
/viewposts - List scheduled posts
/addadmin <username> - Request to add a new admin`
  );
});

bot.onText(/\/whoami/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from?.username || "N/A";
  const firstName = msg.from?.first_name || "";
  const lastName = msg.from?.last_name || "";
  const userId = msg.from?.id;

  const fullName = `${firstName} ${lastName}`.trim();
  const isSuperAdmin = username === superAdminUsername;
  const isGroupAdmin = allowedAdmins[chatId]?.has(username);

  console.log(`[WHOAMI] User ${username} (ID: ${userId}) requested their info`);

  bot.sendMessage(
    chatId,
    `👤 Your Info:
- ID: ${userId}
- Username: @${username}
- Name: ${fullName}
- Chat ID: ${chatId}
- Admin: ${
      isSuperAdmin
        ? "✅ Super Admin"
        : isGroupAdmin
        ? "✅ Group Admin"
        : "❌ No"
    }`
  );
});

// Super admin approves a user
let pendingRequests = [];

bot.onText(/\/addadmin (@?\w+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const requester = msg.from?.username;
  const requested = match?.[1];

  console.log(`[ADDADMIN] User ${requester} requested to add @${requested} as admin`);

  if (!requester || !requested) {
    return bot.sendMessage(chatId, "❌ Invalid request format.");
  }

  // Store pending requests
  pendingRequests.push({
    chatId: chatId,
    requestedUser: requested,
    requester: requester
  });

  // Send request to the super admin
  bot.sendMessage(
    superAdminId, // Use the superAdminId here, not the username
    `👮 Admin request: User @${requester} requested to add @${requested} as admin in chat ${chatId}.\n\nReply with "approve ${chatId} @${requested}" or "deny ${chatId} @${requested}".`
  );
  bot.sendMessage(chatId, "🕵️ Request sent to super admin for approval.");
});
console.log("🚀 ~ pendingRequests:", pendingRequests)


bot.onText(/\/approve (@?\w+)/, (msg, match) => {
  console.log(`[APPROVE] Super Admin approval attempt by ${msg.from?.username}`);
console.log("🚀 ~ pendingRequests:", pendingRequests)

  const fromId = msg.from?.id;
  const approvedUsername = match[1].replace('@', '');

  // Check if the user is the super admin
  if (fromId !== superAdminId) {
    console.log("❌ Only super admin can approve.");
    return bot.sendMessage(msg.chat.id, "🚫 Only super admin can approve.");
  }

  // Make sure that pendingRequests is properly initialized and populated
  console.log("🔍 Checking for pending requests for:", approvedUsername);

  // Find all matching requests for this username
const matches = pendingRequests.filter(req => req.requestedUser === '@' + approvedUsername);

  if (matches.length === 0) {
    return bot.sendMessage(msg.chat.id, `❌ No pending requests found for @${approvedUsername}.`);
  }

  matches.forEach(req => {
    // Add to allowed admins set
    if (!allowedAdmins[req.chatId]) allowedAdmins[req.chatId] = new Set();
    allowedAdmins[req.chatId].add(approvedUsername);

    // Notify the chat where the request originated
    bot.sendMessage(req.chatId, `✅ @${approvedUsername} has been approved as an admin by the super admin.`);

    // Notify the super admin
    bot.sendMessage(superAdminId, `✅ You have approved @${approvedUsername} as an admin for chat ${req.chatId}.`);
  });

  // Remove all approved requests for this user
  pendingRequests = pendingRequests.filter(req => req.requestedUser !== approvedUsername);
});

bot.onText(/\/newpost/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from?.username || "";

  const isSuper = msg.from?.id === superAdminId;
  const isAdmin = allowedAdmins[chatId]?.has(username);

  console.log(`[NEWPOST] User ${username} (ID: ${msg.from?.id}) trying to schedule a post`);

  if (!isAdmin && !isSuper) {
    return bot.sendMessage(chatId, "🚫 You are not authorized.");
  }

  userStates[chatId] = { step: "awaiting_content" };
  bot.sendMessage(chatId, "📝 Send the photo or text to schedule.");
});

bot.onText(/\/viewposts/, (msg) => {
  const chatId = msg.chat.id;

  console.log(`[VIEWPOSTS] User ${msg.from?.username} requested scheduled posts`);

  const posts = scheduledPosts.filter((post) => post.chatId === chatId);

  if (posts.length === 0) {
    return bot.sendMessage(chatId, "📭 No posts scheduled.");
  }

  const list = posts.map(
    (p, i) =>
      `${i + 1}. ${p.recurring ? "🔁" : "📅"} ${
        p.day !== undefined ? "Day " + p.day : ""
      } ${p.hour}:${String(p.minute).padStart(2, "0")}`
  );
  bot.sendMessage(chatId, `📆 Scheduled posts:\n` + list.join("\n"));
});

// --- MESSAGE FLOW ---
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  console.log(`[MESSAGE] Received message from ${msg.from?.username || 'Unknown'}`);

  if (!state || (msg.text && msg.text.startsWith("/"))) return;

  if (state.step === "awaiting_content") {
    if (!msg.text && !msg.photo) {
      return bot.sendMessage(chatId, "❌ Send text or photo.");
    }

    state.content = msg;
    state.step = "awaiting_time";
    return bot.sendMessage(
      chatId,
      '⏰ Enter time (HH:MM) or recurring (e.g. "every sunday at 13:00").'
    );
  }

  if (state.step === "awaiting_time") {
    const recurringMatch = msg.text?.match(
      /every (\w+)(?: at (\d{1,2}):(\d{2}))?/
    );
    const timeMatch = msg.text?.match(/^(\d{1,2}):(\d{2})$/);

    if (recurringMatch) {
      const dayMap = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
      };
      const day = dayMap[recurringMatch[1].toLowerCase()];
      const hour = parseInt(recurringMatch[2] || "13");
      const minute = parseInt(recurringMatch[3] || "0");

      scheduledPosts.push({
        chatId,
        hour,
        minute,
        day,
        content: state.content,
        recurring: true,
      });
    } else if (timeMatch) {
      const hour = parseInt(timeMatch[1]);
      const minute = parseInt(timeMatch[2]);

      scheduledPosts.push({
        chatId,
        hour,
        minute,
        content: state.content,
        recurring: false,
      });
    } else {
      return bot.sendMessage(
        chatId,
        '❌ Invalid format. Try HH:MM or "every Sunday at 13:00"'
      );
    }

    delete userStates[chatId];
    bot.sendMessage(chatId, "✅ Post scheduled.");
  }
});

// --- CRON EXECUTION ---
cron.schedule("* * * * *", () => {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const day = now.getDay();

  scheduledPosts.forEach((post, index) => {
    const timeMatch = post.hour === hour && post.minute === minute;
    const dayMatch = post.recurring ? post.day === day : true;

    if (timeMatch && dayMatch) {
      const { chatId, content } = post;

      if (content.photo) {
        const fileId = content.photo[content.photo.length - 1].file_id;
        const caption = content.caption || "";
        bot.sendPhoto(chatId, fileId, { caption });
      } else if (content.text) {
        bot.sendMessage(chatId, content.text);
      }

      if (!post.recurring) scheduledPosts.splice(index, 1);
    }
  });
});
