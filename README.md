# Make Friends Backend

Make Friends Backend คือ REST API ฝั่งเซิร์ฟเวอร์ของแอปพลิเคชัน Make Friends ที่ออกแบบมาเพื่อรองรับการทำงานหลักของระบบ เช่น การยืนยันตัวตนผู้ใช้ การจัดการกิจกรรม การแจ้งเตือน การสื่อสาร และการจัดการข้อมูลที่เกี่ยวข้องกับผู้ใช้ในแอปพลิเคชันเพื่อการพบปะและทำกิจกรรมร่วมกัน

## ภาพรวมของโปรเจกต์

โปรเจกต์นี้ถูกพัฒนาเพื่อเป็นโครงสร้างเซิร์ฟเวอร์ที่สามารถเชื่อมต่อกับแอป Frontend ได้อย่างมีประสิทธิภาพ โดยเน้นการแยกความรับผิดชอบของแต่ละฟีเจอร์ให้ชัดเจนผ่าน Route Modules ต่าง ๆ ทำให้โค้ดสามารถดูแลและขยายระบบได้ง่ายขึ้น

### จุดประสงค์หลัก
- จัดการกระบวนการสมัครสมาชิกและเข้าสู่ระบบของผู้ใช้
- รองรับการสร้าง แก้ไข ลบ และค้นหาข้อมูลกิจกรรม
- ให้บริการระบบการเข้าร่วมกิจกรรมและการจัดการสถานะต่าง ๆ
- ตอบสนองความต้องการของระบบแจ้งเตือนและการสื่อสารระหว่างผู้ใช้
- ตรวจสอบความถูกต้องของข้อมูลและความปลอดภัยของ API

## ฟีเจอร์หลัก

- **Authentication & Authorization**
  - สมัครสมาชิก / เข้าสู่ระบบ / ออกจากระบบ
  - ใช้ JWT ในการตรวจสอบสิทธิ์ของผู้ใช้
  - รองรับการจัดการ session และการตรวจสอบความปลอดภัยของ request

- **Activity Management**
  - สร้างกิจกรรมใหม่
  - แก้ไขและลบกิจกรรม
  - ดึงข้อมูลกิจกรรมและจัดการการเข้าร่วมของผู้ใช้

- **Join / Reservation System**
  - ผู้ใช้สามารถเข้าร่วมกิจกรรม
  - รองรับการตรวจสอบสถานะการเข้าร่วมและการจัดการคิวสำรอง

- **Notification System**
  - แจ้งเตือนเหตุการณ์สำคัญที่เกิดขึ้นในแอป
  - รองรับข้อความอัปเดตสถานะและการตอบกลับจากระบบ

- **Messaging / Chat**
  - สนับสนุนการสื่อสารระหว่างผู้ใช้ในระดับของกิจกรรมหรือกลุ่มที่เกี่ยวข้อง

- **Email Verification**
  - รองรับการยืนยันตัวตนผ่านอีเมลเพื่อเพิ่มความน่าเชื่อถือของบัญชีผู้ใช้

- **File Upload Support**
  - ใช้ Multer เพื่อรองรับการอัปโหลดไฟล์ที่เกี่ยวข้องกับผู้ใช้หรือกิจกรรม

## เทคโนโลยีที่ใช้

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database / Backend Service**: Supabase
- **Authentication**: JSON Web Token (JWT)
- **File Upload**: Multer
- **Email Service**: Nodemailer / Resend
- **Security**: CORS, Rate Limiting, Password Hashing
- **Background Jobs**: node-cron

## สถาปัตยกรรมของระบบ

ตัวเซิร์ฟเวอร์ถูกสร้างขึ้นจากโครงสร้างที่มุ่งเน้นการแยกส่วนของฟีเจอร์ออกจากกัน โดยมีจุดเริ่มต้นหลักอยู่ที่ [index.js](index.js) และแบ่งฟังก์ชันหลักตาม Route Modules ต่าง ๆ ดังนี้

| ส่วน | หน้าที่หลัก |
|---|---|
| [index.js](index.js) | จุดเริ่มต้นของเซิร์ฟเวอร์ และการตั้งค่า Middleware หลัก |
| [routes/authRoutes.js](routes/authRoutes.js) | การสมัครสมาชิก การเข้าสู่ระบบ และการตรวจสอบสิทธิ์ |
| [routes/userRoutes.js](routes/userRoutes.js) | จัดการข้อมูลผู้ใช้ และข้อมูลส่วนตัว |
| [routes/activityRoutes.js](routes/activityRoutes.js) | CRUD ของกิจกรรมและการจัดการการร่วมกิจกรรม |
| [routes/messageRoutes.js](routes/messageRoutes.js) | ฟีเจอร์การส่งข้อความและการสนทนา |
| [routes/notificationRoutes.js](routes/notificationRoutes.js) | ระบบแจ้งเตือนและข้อมูลอัปเดตต่าง ๆ |
| [routes/report.js](routes/report.js) | ระบบรายงานและการตรวจสอบสถานะที่เกี่ยวข้อง |
| [routes/verificationRoutes.js](routes/verificationRoutes.js) | การยืนยันบัญชีผ่านอีเมล |
| [cron/activityCron.js](cron/activityCron.js) | งานเบื้องหลังสำหรับการอัปเดตสถานะกิจกรรมตามเวลา |

## โครงสร้างโปรเจกต์

```text
makefriends_backend/
├── config/               # การตั้งค่าที่เกี่ยวกับบริการภายนอก เช่น Supabase
├── cron/                 # งานที่ทำงานในพื้นหลังตามเวลา
├── middlewares/          # Middleware สำหรับการตรวจสอบและการอัปโหลดไฟล์
├── routes/               # Endpoint ของระบบตามฟีเจอร์ต่าง ๆ
├── index.js              # จุดเริ่มต้นการทำงานของ API
├── package.json          # รายการ dependency และ script ของโปรเจกต์
└── .env                  # ตัวแปรสภาพแวดล้อม (ไม่ควร commit ลง Git)
```

## การติดตั้งและตั้งค่า

### 1) Clone โปรเจกต์

```bash
git clone <repository-url>
cd makefriends_backend
```

### 2) ติดตั้ง dependencies

```bash
npm install
```

### 3) สร้างไฟล์ `.env`

ตัวอย่างค่าในไฟล์ `.env`:

```env
PORT=3000
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
JWT_SECRET=your_jwt_secret
RESEND_API_KEY=your_resend_key
EMAIL_FROM=your_email
```

> ค่าที่อยู่ใน `.env` จะต้องตรงกับการตั้งค่าจริงของระบบของคุณ เพราะโค้ดใช้ Supabase และบริการส่งอีเมลเพื่อให้ API ทำงานครบถ้วน

## วิธีรันเซิร์ฟเวอร์

### Development Mode

```bash
npx nodemon index.js
```

### Production Mode

```bash
npm start
```

## กระบวนการทำงานของ API

เมื่อเซิร์ฟเวอร์เริ่มทำงาน จะทำการตั้งค่า middleware หลัก เช่น CORS และ JSON parser จากนั้นจะ register route ต่าง ๆ ตามฟีเจอร์ที่กำหนดไว้ เพื่อรับ request จาก Frontend และประมวลผลข้อมูลผ่าน Supabase หรือบริการอื่น ๆ ที่จำเป็น

### Flow การทำงานโดยสรุป
1. Client ส่ง request ไปยัง API
2. Server ตรวจสอบ middleware และ authentication
3. Router ตัดสินใจว่าจะเรียก logic ใดต่อ
4. ระบบดึงหรือบันทึกข้อมูลจากฐานข้อมูล / บริการภายนอก
5. Server ส่ง response กลับไปยัง Frontend

## งานเบื้องหลัง (Background Jobs)

โปรเจกต์นี้ใช้ `node-cron` เพื่อตรวจสอบและดำเนินการงานอัตโนมัติในช่วงเวลาที่กำหนด ซึ่งช่วยให้ระบบสามารถอัปเดตสถานะหรือดำเนินการที่เกี่ยวข้องกับกิจกรรมโดยไม่ต้องมีการเรียกใช้งานโดยตรงจากผู้ใช้ทุกครั้ง

## ความปลอดภัยของระบบ

โค้ดนี้มีแนวทางการปกป้อง API หลัก ๆ ดังนี้:
- ใช้ JWT เพื่อจำกัดการเข้าถึงข้อมูลที่ต้องการสิทธิ์เฉพาะ
- ใช้ CORS เพื่อควบคุมแหล่งที่มาของ request
- ใช้ express-rate-limit เพื่อลดความเสี่ยงจากการโจมตีแบบ brute force
- ใช้การ hash password และการตรวจสอบข้อมูลก่อนดำเนินการหลัก

## ทำไมโปรเจกต์นี้น่าสนใจสำหรับ Portfolio

โปรเจกต์นี้แสดงให้เห็นถึงทักษะที่สำคัญของนักพัฒนา Backend อย่างหลากหลาย เช่น
- การออกแบบและพัฒนา REST API
- การจัดการ authentication และ authorization
- การทำงานกับฐานข้อมูลและบริการ Cloud
- การใช้ middleware และการจัดโครงสร้างโปรเจกต์อย่างเป็นระบบ
- การจัดการ workflow ที่เกี่ยวข้องกับกิจกรรมและการแจ้งเตือน
- การพัฒนา API ที่สามารถเชื่อมต่อกับแอปมือถือจริงได้

## ตัวอย่างบทสรุปสำหรับ GitHub Portfolio

**Make Friends Backend** เป็น REST API ที่พัฒนาโดยใช้ Node.js และ Express สำหรับรองรับระบบผู้ใช้ กิจกรรม การแจ้งเตือน การสื่อสาร และการยืนยันอีเมลในแอปพลิเคชันที่เชื่อมโยงผู้คนเพื่อทำกิจกรรมร่วมกัน โครงการนี้สะท้อนทักษะด้าน API Design, Backend Architecture, Security, และการทำงานร่วมกับบริการภายนอกอย่าง Supabase และ Email Service

## สรุปสั้นสำหรับ Resume / CV

**Make Friends Backend** เป็นระบบ API สำหรับแอป Make Friends ที่พัฒนาด้วย Node.js, Express และ Supabase โดยรับผิดชอบด้านการยืนยันตัวตนผู้ใช้ การจัดการกิจกรรม ระบบแจ้งเตือน และการสื่อสารระหว่างผู้ใช้ ผมใช้โครงสร้างที่แยกฟีเจอร์ชัดเจนเพื่อให้ระบบง่ายต่อการบำรุงรักษาและขยายฟังก์ชันในอนาคต
