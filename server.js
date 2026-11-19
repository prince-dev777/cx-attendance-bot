import http from 'http';
import https from 'https';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

// --- Configured Staff Profiles ---
const USERS = {
  prince: {
    staffId: '1',
    name: 'Prince Kumar',
    phone: '8538949912',
    chatId: '6333495869',
    username: 'saware01',
    deviceSN: 'Desktop QR Scanner',
    verifyType: 'QR Scanner'
  },
  rahul: {
    staffId: '2',
    name: 'Rahul Titarmare',
    phone: '9270875415',
    chatId: '679610147',
    username: 'rahulsir67',
    deviceSN: 'Desktop QR Scanner',
    verifyType: 'QR Scanner'
  }
};

// --- MongoDB Schemas ---
const staffAttendanceSchema = new mongoose.Schema({
  instituteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institute', default: null },
  id: { type: String },
  staffId: { type: String, required: true },
  staffName: { type: String, required: true },
  department: { type: String, default: 'General' },
  designation: { type: String, default: 'Staff' },
  date: { type: String, required: true },
  entryTime: { type: String, default: '--' },
  exitTime: { type: String, default: '--' },
  punches: [{
    type: { type: String, enum: ['IN', 'OUT'] },
    time: { type: String },
    timestamp: { type: Date, default: Date.now },
    deviceSN: { type: String, default: 'Desktop QR Scanner' },
    round: { type: Number, default: 1 }
  }],
  status: { type: String, default: 'present' },
  durationMinutes: { type: Number, default: 0 },
  workHoursFormatted: { type: String, default: '0h 0m' },
  deviceSN: { type: String, default: 'Desktop QR Scanner' },
  deviceIp: { type: String, default: '' },
  verifyType: { type: String, default: 'QR Scanner' },
  source: { type: String, default: 'BIOMETRIC_PUSH' },
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

const smsLogSchema = new mongoose.Schema({
  instituteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institute', default: null },
  id: { type: String, required: true },
  type: { type: String, required: true },
  studentId: { type: String, required: true },
  parentPhone: { type: String, required: true },
  message: { type: String, required: true },
  timestamp: { type: String, required: true },
  status: { type: String, default: 'pending' },
  sessionName: { type: String, default: null },
  sessionId: { type: String, default: null },
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

const staffSchema = new mongoose.Schema({
  staffId: { type: String },
  name: { type: String },
  phone: { type: String },
  department: { type: String },
  designation: { type: String },
  instituteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institute' },
  isDeleted: { type: Boolean, default: false }
}, { strict: false });

const StaffAttendance = mongoose.model('StaffAttendance', staffAttendanceSchema);
const SMSLog = mongoose.model('SMSLog', smsLogSchema);
const Staff = mongoose.model('Staff', staffSchema);

// --- Distributed Atomic Deduplication Schema (Prevents Multi-Instance & Cloud Race Collisions) ---
const processedUpdateSchema = new mongoose.Schema({
  updateId: { type: Number, required: true, unique: true },
  messageId: { type: Number },
  chatId: { type: String },
  command: { type: String },
  createdAt: { type: Date, default: Date.now, expires: 600 } // Auto-deletes after 10m TTL
});

const ProcessedUpdate = mongoose.model('ProcessedUpdate', processedUpdateSchema);

// --- Time Helper Functions (Strict IST Asia/Kolkata) ---
function getNowIST() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const formattedDate = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  return { now, timeStr, dateStr, formattedDate };
}

function parseTimeToMins(timeStr) {
  if (!timeStr || timeStr === '--') return null;
  const match = timeStr.match(/(\d{1,2}):(\d{1,2})\s*(AM|PM)?/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const mod = match[3] ? match[3].toUpperCase() : null;
  if (mod === 'PM' && h < 12) h += 12;
  if (mod === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function calculateWorkDuration(punches = []) {
  if (!Array.isArray(punches) || punches.length === 0) {
    return { durationMinutes: 0, workHoursFormatted: '0h 0m' };
  }
  let totalMins = 0;
  let currentInMins = null;

  for (const p of punches) {
    if (p.type === 'IN') {
      currentInMins = parseTimeToMins(p.time);
    } else if (p.type === 'OUT' && currentInMins !== null) {
      const outMins = parseTimeToMins(p.time);
      if (outMins !== null && outMins >= currentInMins) {
        totalMins += (outMins - currentInMins);
      }
      currentInMins = null;
    }
  }

  const hours = Math.floor(totalMins / 60);
  const minutes = totalMins % 60;
  return { durationMinutes: totalMins, workHoursFormatted: `${hours}h ${minutes}m` };
}

// --- Telegram API Helpers ---
function telegramRequest(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ ok: false, error: data }); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'TIMEOUT' }); });
    req.write(postData);
    req.end();
  });
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  try {
    return await telegramRequest('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    });
  } catch (err) {
    console.error('[Telegram] Error sending message:', err.message);
    return null;
  }
}

function getActionKeyboard() {
  return {
    keyboard: [
      [{ text: '🟢 Check-In' }, { text: '🔴 Check-Out' }],
      [{ text: '⏱️ Today Status' }]
    ],
    resize_keyboard: true,
    persistent: true
  };
}

function getProfileByChatId(chatId) {
  const strId = String(chatId);
  for (const [key, user] of Object.entries(USERS)) {
    if (user.chatId && String(user.chatId) === strId) {
      return { key, ...user };
    }
  }
  return null;
}

// --- In-Memory Anti-Bounce Cooldown Maps (Prevents rapid duplicate taps & race conditions) ---
const punchCooldownMap = new Map(); // key: `${staffId}_${punchType}` -> timestamp ms
const commandCooldownMap = new Map(); // key: `${chatId}_${commandText}` -> timestamp ms

// --- Attendance Record Handler ---
async function handlePunch(profile, punchType, customTimeStr = null) {
  const { timeStr, dateStr, formattedDate } = getNowIST();
  const effectiveTime = customTimeStr || timeStr;
  const staffId = String(profile.staffId);
  const cooldownKey = `${staffId}_${punchType}`;
  const nowMs = Date.now();

  // 🛡️ Step 0: In-Memory Anti-Bounce Protection (45s window against duplicate network requests)
  const lastMemoryPunchMs = punchCooldownMap.get(cooldownKey) || 0;
  if (nowMs - lastMemoryPunchMs < 45000) {
    const elapsedSeconds = Math.max(1, Math.round((nowMs - lastMemoryPunchMs) / 1000));
    console.log(`[Anti-Bounce] ⚡ Suppressed rapid in-memory duplicate ${punchType} for staff #${staffId} (${elapsedSeconds}s ago).`);
    return { isDuplicate: true, elapsedSeconds, effectiveTime, dateStr, record: null };
  }

  // 1. Fetch Staff Member from DB to get latest designation & instituteId
  const staffMember = await Staff.findOne({
    isDeleted: { $ne: true },
    $or: [
      { staffId: profile.staffId },
      { staffId: String(profile.staffId) },
      { id: `STAFF_${profile.staffId}` }
    ]
  });

  const department = staffMember?.department || 'General';
  const designation = staffMember?.designation || 'Staff';
  const instituteId = staffMember?.instituteId || null;
  const staffName = staffMember?.name || profile.name;
  const phone = staffMember?.phone || profile.phone;

  // 2. Fetch or create today's record
  let record = await StaffAttendance.findOne({
    isDeleted: { $ne: true },
    staffId: profile.staffId,
    date: dateStr
  });

  const chosenDeviceSN = profile.deviceSN || 'Desktop QR Scanner';
  const chosenVerifyType = profile.verifyType || 'QR Scanner';

  if (!record) {
    record = new StaffAttendance({
      instituteId,
      id: `STAFF_ATT_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      staffId: profile.staffId,
      staffName,
      department,
      designation,
      date: dateStr,
      entryTime: punchType === 'IN' ? effectiveTime : '--',
      exitTime: punchType === 'OUT' ? effectiveTime : '--',
      punches: [{
        type: punchType,
        time: effectiveTime,
        timestamp: new Date(),
        deviceSN: chosenDeviceSN,
        round: 1
      }],
      status: 'present',
      durationMinutes: 0,
      workHoursFormatted: '0h 0m',
      deviceSN: chosenDeviceSN,
      verifyType: chosenVerifyType,
      source: 'BIOMETRIC_PUSH'
    });
  } else {
    // 🛡️ Step 0.5: Database-level Anti-Bounce (if last punch was of same type within 60s)
    if (Array.isArray(record.punches) && record.punches.length > 0) {
      const lastPunch = record.punches[record.punches.length - 1];
      const lastPunchMs = lastPunch.timestamp ? new Date(lastPunch.timestamp).getTime() : 0;
      const elapsedSeconds = Math.max(1, Math.round((nowMs - lastPunchMs) / 1000));
      if (elapsedSeconds < 60 && lastPunch.type === punchType) {
        console.log(`[Anti-Bounce DB] ⚡ Suppressed duplicate ${punchType} for ${staffName} (#${staffId}) - already recorded ${elapsedSeconds}s ago.`);
        punchCooldownMap.set(cooldownKey, nowMs);
        return { isDuplicate: true, elapsedSeconds, effectiveTime: lastPunch.time || effectiveTime, dateStr, record };
      }
    }

    // Determine Round
    const round = punchType === 'IN'
      ? record.punches.filter(p => p.type === 'IN').length + 1
      : record.punches.filter(p => p.type === 'OUT').length + 1;

    if (punchType === 'IN') {
      if (!record.entryTime || record.entryTime === '--') {
        record.entryTime = effectiveTime;
      }
      record.exitTime = '--';
    } else {
      record.exitTime = effectiveTime;
    }

    record.punches.push({
      type: punchType,
      time: effectiveTime,
      timestamp: new Date(),
      deviceSN: chosenDeviceSN,
      round
    });

    record.deviceSN = chosenDeviceSN;
    record.verifyType = chosenVerifyType;

    const dur = calculateWorkDuration(record.punches);
    record.durationMinutes = dur.durationMinutes;
    record.workHoursFormatted = dur.workHoursFormatted;
    record.status = 'present';
  }

  record.markModified('punches');
  await record.save();

  // Commit cooldown timestamp now that punch is safely recorded
  punchCooldownMap.set(cooldownKey, nowMs);

  // 3. Queue WhatsApp Alert in SMSLog (Master PC will automatically dispatch it)
  if (phone) {
    const durationSuffix = (punchType === 'OUT' && record.workHoursFormatted && record.workHoursFormatted !== '0h 0m')
      ? ` (Total Work Hours: ${record.workHoursFormatted})`
      : '';

    const messageText = punchType === 'IN'
      ? `Dear ${staffName}, your staff attendance check-in has been safely recorded on ${formattedDate} at ${effectiveTime}. - Career Xone`
      : `Dear ${staffName}, your staff attendance check-out has been safely recorded on ${formattedDate} at ${effectiveTime}${durationSuffix}. - Career Xone`;

    try {
      const smsLog = new SMSLog({
        instituteId,
        id: `SMS${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: punchType === 'IN' ? 'attendance-entry' : 'attendance-exit',
        studentId: profile.staffId,
        parentPhone: phone,
        message: messageText,
        timestamp: new Date().toISOString(),
        status: 'pending',
        sessionName: `${department} Duty`
      });
      await smsLog.save();
      console.log(`[AttendanceBot] 📱 Queued pending WhatsApp alert for ${staffName} (${phone}) in SMSLog.`);
    } catch (smsErr) {
      console.warn('[AttendanceBot] Warning saving SMSLog:', smsErr.message);
    }
  }

  return { record, effectiveTime, dateStr };
}

// --- Telegram Update Processor ---
async function handleUpdate(update) {
  try {
    if (!update.message || !update.message.text) return;
    const updateId = update.update_id;
    const messageId = update.message.message_id;
    const chatId = update.message.chat.id;
    const rawText = update.message.text.trim();
    const lowerText = rawText.toLowerCase();

    // 🛡️ Layer 1: Distributed Cross-Server / Multi-Instance Deduplication via MongoDB Atomic Lock
    if (updateId) {
      try {
        await ProcessedUpdate.create({
          updateId,
          messageId,
          chatId: String(chatId),
          command: rawText
        });
      } catch (dupErr) {
        if (dupErr.code === 11000) {
          console.log(`[Deduplication] ⚡ Blocked duplicate Telegram update #${updateId} from another instance/retry.`);
          return; // STOP! Already processed by another instance or thread!
        }
      }
    }

    // 🛡️ Layer 2: Rapid Tap Cooldown (4s window for identical command per chat)
    const commandKey = `${chatId}_${lowerText}`;
    const now = Date.now();
    const lastCmdTime = commandCooldownMap.get(commandKey) || 0;
    if (now - lastCmdTime < 4000) {
      console.log(`[Command Debounce] ⚡ Suppressed rapid duplicate '${rawText}' for chat ${chatId} (${Math.round((now - lastCmdTime) / 1000)}s ago).`);
      return;
    }
    commandCooldownMap.set(commandKey, now);

    const profile = getProfileByChatId(chatId);
    if (!profile) {
      await sendTelegramMessage(chatId, `⚠️ Unauthorized: Your Telegram ID (<code>${chatId}</code>) is not registered.`);
      return;
    }

    // Status Command
    if (lowerText.includes('status') || lowerText === '/status') {
      const { dateStr } = getNowIST();
      const rec = await StaffAttendance.findOne({ staffId: profile.staffId, date: dateStr, isDeleted: { $ne: true } });
      const entry = rec?.entryTime && rec.entryTime !== '--' ? rec.entryTime : 'Not Marked';
      const exit = rec?.exitTime && rec.exitTime !== '--' ? rec.exitTime : 'Not Marked';
      const duration = rec?.workHoursFormatted && rec.workHoursFormatted !== '0h 0m' ? rec.workHoursFormatted : '--';

      let statusMsg = '⚪ Not Started';
      if (entry !== 'Not Marked' && exit === 'Not Marked') statusMsg = '🟢 Currently on Duty';
      else if (exit !== 'Not Marked') statusMsg = '🏁 Completed for Today';

      await sendTelegramMessage(chatId,
        `📊 <b>Today's Attendance Status</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Staff:</b> ${profile.name} (#${profile.staffId})\n` +
        `📅 <b>Date:</b> ${dateStr}\n` +
        `📌 <b>Status:</b> ${statusMsg}\n` +
        `🕒 <b>Check-In:</b> <code>${entry}</code>\n` +
        `🕕 <b>Check-Out:</b> <code>${exit}</code>\n` +
        `⏱️ <b>Duty Hours:</b> <b>${duration}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━`,
        getActionKeyboard()
      );
      return;
    }

    // Check-In Command
    if (lowerText.startsWith('/in') || lowerText.includes('check-in') || lowerText.includes('punch-in')) {
      const punchRes = await handlePunch(profile, 'IN');
      if (punchRes.isDuplicate) {
        await sendTelegramMessage(chatId,
          `⚠️ <b>Check-In Already Recorded!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 <b>Staff:</b> ${profile.name} (#${profile.staffId})\n` +
          `🕒 <b>Time:</b> <code>${punchRes.effectiveTime}</code> (${punchRes.elapsedSeconds}s ago)\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<i>Duplicate tap safely ignored to prevent duplicate alerts.</i>`,
          getActionKeyboard()
        );
        return;
      }

      await sendTelegramMessage(chatId,
        `🟢 <b>CHECK-IN RECORDED!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Staff:</b> ${profile.name} (#${profile.staffId})\n` +
        `📅 <b>Date:</b> ${punchRes.dateStr}\n` +
        `🕒 <b>Time:</b> <code>${punchRes.effectiveTime}</code>\n` +
        `📱 <b>WhatsApp:</b> Triggered for <code>${profile.phone}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Have a productive day at Career Xone!</i>`,
        getActionKeyboard()
      );
      return;
    }

    // Check-Out Command
    if (lowerText.startsWith('/out') || lowerText.includes('check-out') || lowerText.includes('punch-out')) {
      const punchRes = await handlePunch(profile, 'OUT');
      if (punchRes.isDuplicate) {
        await sendTelegramMessage(chatId,
          `⚠️ <b>Check-Out Already Recorded!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 <b>Staff:</b> ${profile.name} (#${profile.staffId})\n` +
          `🕒 <b>Time:</b> <code>${punchRes.effectiveTime}</code> (${punchRes.elapsedSeconds}s ago)\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<i>Duplicate tap safely ignored to prevent duplicate alerts.</i>`,
          getActionKeyboard()
        );
        return;
      }

      const duration = punchRes.record?.workHoursFormatted || 'Recorded';
      await sendTelegramMessage(chatId,
        `🔴 <b>CHECK-OUT RECORDED!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 <b>Staff:</b> ${profile.name} (#${profile.staffId})\n` +
        `📅 <b>Date:</b> ${punchRes.dateStr}\n` +
        `🕒 <b>Exit Time:</b> <code>${punchRes.effectiveTime}</code>\n` +
        `⏱️ <b>Total Duty:</b> <b>${duration}</b>\n` +
        `📱 <b>WhatsApp:</b> Triggered with Duration for <code>${profile.phone}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Great job today! Rest well.</i>`,
        getActionKeyboard()
      );
      return;
    }

    // Help / Fallback
    await sendTelegramMessage(chatId,
      `👋 Hello <b>${profile.name}</b>!\n\n` +
      `Use the buttons below to mark your attendance, or type:\n` +
      `• <code>/in</code> ➔ Check-In now\n` +
      `• <code>/out</code> ➔ Check-Out now\n` +
      `• <code>/status</code> ➔ View today's duty hours`,
      getActionKeyboard()
    );
  } catch (err) {
    console.error('[AttendanceBot] Error handling update:', err.message);
  }
}

// --- Long Polling Engine ---
let isPolling = true;
let pollingOffset = 0;

async function startPolling() {
  console.log('🤖 [AttendanceBot] Long polling started...');
  while (isPolling) {
    try {
      const res = await telegramRequest('getUpdates', {
        offset: pollingOffset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query']
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          pollingOffset = update.update_id + 1;
          await handleUpdate(update);
        }
      }
    } catch (err) {
      await new Promise(r => setTimeout(r, 4000));
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

// --- HTTP Healthcheck Server (For Render / Cloud hosting) ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'online', service: 'CX Attendance Bot', time: new Date().toISOString() }));
});

// --- 24/7 Keep-Alive Self-Ping (Prevents Cloud Free-Tier Spin Down) ---
function setupKeepAlive() {
  const targetUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  if (!targetUrl) {
    console.log('ℹ️ [Keep-Alive] No RENDER_EXTERNAL_URL or APP_URL configured in env. Self-ping skipped.');
    return;
  }

  const PING_INTERVAL_MS = 9 * 60 * 1000; // 9 minutes (Prevents free tier inactivity shutdown)
  console.log(`⏱️ [Keep-Alive] Initializing self-ping loop targeting ${targetUrl} (every 9m)`);

  const ping = () => {
    try {
      const client = targetUrl.startsWith('https') ? https : http;
      client.get(targetUrl, (res) => {
        const istTime = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        console.log(`[Keep-Alive] 💓 Self-ping ${targetUrl} -> HTTP ${res.statusCode} at ${istTime} IST`);
      }).on('error', (err) => {
        console.warn(`[Keep-Alive] ⚠️ Ping warning: ${err.message}`);
      });
    } catch (e) {
      console.warn(`[Keep-Alive] ⚠️ Ping error: ${e.message}`);
    }
  };

  // Initial ping after 30 seconds to verify loop
  setTimeout(ping, 30 * 1000);

  // Periodic recurring ping
  setInterval(ping, PING_INTERVAL_MS);
}

// --- Boot Application ---
async function main() {
  if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is required in environment variables.');
    process.exit(1);
  }
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is required in environment variables.');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB Atlas Cloud Cluster');

  // Verify Telegram Connection
  const me = await telegramRequest('getMe');
  if (me?.ok) {
    console.log(`🤖 Connected to Telegram as @${me.result.username} (${me.result.first_name})`);
  } else {
    console.error('❌ Telegram connection failed:', me);
  }

  server.listen(PORT, () => {
    console.log(`🌐 Healthcheck HTTP Server listening on port ${PORT}`);
    startPolling();
    setupKeepAlive();
  });
}

main().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
