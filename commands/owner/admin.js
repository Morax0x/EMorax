const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const https = require('https');

// 🔒 ايدي المالك (أنت فقط)
const OWNER_ID = "1145327691772481577";

// 📂 تحديد المسارات
const rootDir = process.cwd(); // استخدام المسار الجذري المضمون
const DB_PATH = path.join(rootDir, 'mainDB.sqlite');
const WAL_PATH = path.join(rootDir, 'mainDB.sqlite-wal');
const SHM_PATH = path.join(rootDir, 'mainDB.sqlite-shm');
const TEMP_PATH = path.join(rootDir, 'temp_upload.sqlite'); 

module.exports = {
    name: 'admin',
    aliases: ['do', 'up', 'sss'],
    description: 'أوامر إدارة قاعدة البيانات للمالك فقط',
    category: "Admin",

    async execute(message, args) {
        // 1. التحقق من المالك
        if (message.author.id !== OWNER_ID) return;

        const client = message.client;
        const sql = client.sql;
        
        const prefix = args.prefix || "-";
        const commandName = message.content.split(" ")[0].slice(prefix.length).toLowerCase();

        // ============================================================
        // 📥 أمر UP: رفع واستبدال قاعدة البيانات (مع ريستارت إجباري)
        // ============================================================
        if (commandName === 'up') {
            const attachment = message.attachments.first();
            
            if (!attachment) return message.reply("⚠️ **أرفق ملف قاعدة البيانات مع الرسالة.**");
            if (!attachment.name.endsWith('.sqlite')) return message.reply("⚠️ **الملف يجب أن يكون بصيغة `.sqlite`**");

            const msg = await message.reply("⏳ **جاري التحميل...**");

            const file = fs.createWriteStream(TEMP_PATH);
            
            https.get(attachment.url, function(response) {
                response.pipe(file);

                file.on('finish', function() {
                    file.close(async () => {
                        try {
                            await msg.edit("🛑 **جاري إيقاف الاتصال، الاستبدال، وإعادة التشغيل الإجباري...**");

                            // 1. إغلاق الاتصال بقاعدة البيانات فوراً
                            try {
                                if (client.sql && client.sql.open) {
                                    client.sql.close();
                                    console.log("[Database] Connection closed manually.");
                                }
                            } catch (e) { console.log("[Database] Already closed."); }

                            // 2. انتظار بسيط لفك قفل الملفات من النظام
                            await new Promise(r => setTimeout(r, 1000));

                            // 3. حذف الملفات القديمة والمؤقتة (WAL/SHM)
                            try { if (fs.existsSync(WAL_PATH)) fs.unlinkSync(WAL_PATH); } catch(e){}
                            try { if (fs.existsSync(SHM_PATH)) fs.unlinkSync(SHM_PATH); } catch(e){}
                            try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch(e){}

                            // 4. وضع الملف الجديد
                            if (fs.existsSync(TEMP_PATH)) {
                                fs.renameSync(TEMP_PATH, DB_PATH);
                                console.log("[Database] File replaced successfully.");
                            } else {
                                throw new Error("فشل تحميل الملف المؤقت.");
                            }

                            // 5. فصل البوت وإعادة التشغيل الإجباري
                            await msg.edit("✅ **تم!** جاري إعادة التشغيل الآن 🔌...");
                            
                            console.log("[System] Force Restarting...");
                            
                            // تدمير اتصال البوت (يظهر أوفلاين فوراً)
                            client.destroy();

                            // الانتظار ثانية ثم قتل العملية برقم 1 (يجبر الاستضافة على الريستارت)
                            setTimeout(() => {
                                process.exit(1); 
                            }, 1000);

                        } catch (err) {
                            console.error(err);
                            await msg.edit(`❌ **خطأ:** ${err.message}`);
                            // محاولة تنظيف الملف المؤقت
                            if (fs.existsSync(TEMP_PATH)) fs.unlinkSync(TEMP_PATH);
                        }
                    });
                });
            }).on('error', function(err) {
                if (fs.existsSync(TEMP_PATH)) fs.unlinkSync(TEMP_PATH);
                msg.edit(`❌ فشل التحميل: ${err.message}`);
            });
        }

        // ============================================================
        // 📤 أمر DO: تحميل نسخة (Download)
        // ============================================================
        else if (commandName === 'do') {
            try {
                // محاولة دمج بيانات WAL قبل النسخ (لضمان أحدث البيانات)
                if (sql && sql.open) {
                    try { sql.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
                }

                if (!fs.existsSync(DB_PATH)) return message.reply("⚠️ ملف قاعدة البيانات غير موجود!");

                const attachment = new AttachmentBuilder(DB_PATH, { name: 'mainDB.sqlite' });
                
                // إرسال في الخاص أولاً
                message.author.send({ 
                    content: `📦 **نسخة احتياطية لقاعدة البيانات**\n📆 <t:${Math.floor(Date.now() / 1000)}:R>`, 
                    files: [attachment] 
                }).then(() => {
                    message.react('✅');
                }).catch(async () => {
                    // إذا الخاص مقفل، أرسل هنا
                    await message.reply({ 
                        content: `⚠️ خاصك مقفل، تفضل النسخة هنا:\n📦 **نسخة احتياطية**`, 
                        files: [attachment] 
                    });
                });

            } catch (err) {
                console.error(err);
                message.reply(`❌ حدث خطأ: ${err.message}`);
            }
        }

        // ============================================================
        // ⚙️ أمر SSS: تعيين قناة النسخ
        // ============================================================
        else if (commandName === 'sss') {
            const channel = message.mentions.channels.first() || message.channel;
            try {
                sql.prepare(`CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT)`).run();
                sql.prepare(`INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)`).run('backup_channel', channel.id);
                message.reply(`✅ تم تعيين قناة النسخ الاحتياطي: ${channel}`);
            } catch (err) {
                message.reply(`❌ حدث خطأ: ${err.message}`);
            }
        }
    }
};
