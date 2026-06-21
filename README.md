# Make Friends Backend

## Overview
Make Friends Backend เป็น REST API สำหรับแอป Make Friends ที่ให้บริการการยืนยันตัวตน จัดการกิจกรรม แจ้งเตือน และการสื่อสารระหว่างผู้ใช้

## Tech Stack

| Category | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| Database / Backend Service | Supabase |
| Authentication | JWT |
| File Upload | Multer |
| Email Service | Resend / Nodemailer |
| Scheduler | node-cron |

## Features
- Authentication & authorization
- Activity CRUD
- Join / reservation flow
- Notifications
- Messaging / chat
- Email verification
- File upload support

## Installation & Configuration

```bash
git clone <repository-url>
cd makefriends_backend
npm install
```

Create a `.env` file with the following values:

```env
PORT=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
RESEND_API_KEY=
EMAIL_FROM=
```

## Running the Server

### Development
```bash
npx nodemon index.js
```

### Production
```bash
npm start
```

## Project Structure

```text
makefriends_backend/
├── config/         # External service configuration
├── cron/           # Background jobs
├── middlewares/    # Auth and upload middleware
├── routes/         # API endpoints
├── index.js        # Server entry point
├── package.json    # Dependencies and scripts
└── .env            # Environment variables
```
