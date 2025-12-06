const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BACKUP_INTERVAL = 3 * 60 * 60 * 1000; // 3 ساعات
const OWNER_ID = "1145327691772481577";
const DB_PATH = path.join(process.cwd(), 'mainDB.sqlite');
const TEMP_PATH = path.join(process.cwd(), 'temp_restore.sqlite');

module.exports = (client, sql) => {
    // 1. دالة النسخ الاحتياطي
    const performBackup = async () => {
        try {
            // جلب آيدي القناة من قاعدة البيانات (التي حفظتها بأمر sss)
            // (ملاحظة: في الكود السابق استخدمت جدول bot_config، سأستخدمه هنا)
            let backupChannelID = null;
            try {
                const row = sql.prepare("SELECT value FROM bot_config WHERE key = 'backup_channel'").get();
                if (row) backupChannelID = row.value;
            } catch (e) {}

            if (!backupChannelID) return; // لم يتم تعيين قناة

            const channel = await client.channels.fetch(backupChannelID).catch(() => null);
            if (!channel) return;

            // تجهيز الملف
            if (sql.open) try { sql.pragma('wal_checkpoint(RESTART)'); } catch (e) {}
            if (!fs.existsSync(DB_PATH)) return;

            const attachment = new AttachmentBuilder(DB_PATH, { name: 'mainDB.sqlite' });

            // زر الاستعادة
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('restore_backup')
                    .setLabel('استعادة هذه النسخة 🔄')
                    .setStyle(ButtonStyle.Danger)
            );

            await channel.send({ 
                content: `📦 **نسخة احتياطية تلقائية**\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>`, 
                files: [attachment],
                components: [row]
            });

        } catch (err) { console.error("[Backup] Error:", err); }
    };

    // تشغيل المؤقت
    setInterval(performBackup, BACKUP_INTERVAL);

    // 2. معالج زر الاستعادة (Restore)
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;
        if (interaction.customId !== 'restore_backup') return;

        // التحقق من المالك
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: "🚫 هذا الزر للمالك فقط.", ephemeral: true });
        }

        const message = interaction.message;
        const attachment = message.attachments.first();

        if (!attachment || !attachment.name.endsWith('.sqlite')) {
            return interaction.reply({ content: "⚠️ لا يوجد ملف قاعدة بيانات صالح في هذه الرسالة.", ephemeral: true });
        }

        await interaction.reply({ content: "⏳ **جاري تحميل النسخة واستبدال القاعدة...**", ephemeral: true });

        // تحميل الملف
        const file = fs.createWriteStream(TEMP_PATH);
        https.get(attachment.url, function(response) {
            response.pipe(file);
            file.on('finish', function() {
                file.close(async () => {
                    try {
                        // إغلاق الاتصال الحالي
                        try { if (sql.open) sql.close(); } catch(e){}

                        // استبدال الملف
                        if (fs.existsSync(TEMP_PATH)) {
                            // حذف القديم
                            try { fs.unlinkSync(DB_PATH); } catch(e){}
                            try { fs.unlinkSync(DB_PATH + '-wal'); } catch(e){}
                            try { fs.unlinkSync(DB_PATH + '-shm'); } catch(e){}
                            
                            // نقل الجديد
                            fs.renameSync(TEMP_PATH, DB_PATH);
                            console.log("[Backup Restore] Database replaced successfully.");
                            
                            await interaction.editReply("✅ **تمت الاستعادة بنجاح!**\n🔌 جاري إعادة التشغيل...");
                            
                            // إعادة التشغيل
                            setTimeout(() => process.kill(process.pid), 1000);
                        }
                    } catch (err) {
                        console.error(err);
                        await interaction.editReply(`❌ **فشل الاستعادة:** ${err.message}`);
                    }
                });
            });
        });
    });
};
