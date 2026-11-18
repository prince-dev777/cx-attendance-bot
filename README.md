# 🤖 CX Attendance Bot (Dedicated Cloud Attendance Service)

This is an independent, 100% isolated attendance bot service for Career Xone.
It is completely decoupled from the main Desktop application (`student-report`).

## 🛡️ Key Features:
- **Zero Boss Traces:** Does not exist inside the Desktop app or pendrive builds.
- **Strict IST Calculations:** Uses `Asia/Kolkata` time zone for all punch calculations.
- **Direct Cloud Sync:** Writes directly to the MongoDB Atlas cluster.
- **Biometric Stealth Masking:** Records punches with `deviceSN: "Biomax Device"` and `verifyType: "Fingerprint"`, appearing 100% identical to physical biometric machine punches.
- **Automated WhatsApp Queue:** Saves pending messages to `SMSLog` for the Master PC WhatsApp engine to deliver.

## 🚀 Running Locally:
```bash
npm install
npm start
```

## ☁️ Deploying to Render (Free 24/7 Cloud):
1. Push this folder to a new private GitHub repository: `cx-attendance-bot`.
2. Go to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** -> **Web Service**.
4. Connect the `cx-attendance-bot` repository.
5. Set Environment Variables:
   - `TELEGRAM_BOT_TOKEN`: (Your Telegram Bot Token)
   - `MONGODB_URI`: (Your MongoDB Atlas connection URI)
6. Click **Deploy**!
