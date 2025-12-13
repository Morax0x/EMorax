const { Events } = require("discord.js");

// الآي دي الخاص بك (المالك الحصري)
const OWNER_ID = process.env.OWNER_ID || '1145327691772481577'; 

const TRASH_EMOJI = '🗑️';

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        // 1. تجاهل البوتات
        if (user.bot) return;

        // 2. التحقق من أن الرياكشن هو السلة
        if (reaction.emoji.name !== TRASH_EMOJI) return;

        // 3. التحقق الحصري: هل الفاعل هو المالك؟
        if (user.id !== OWNER_ID) return;

        // 4. التعامل مع الرسائل القديمة (Partial Messages)
        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                // إذا فشل جلب الرسالة (غالباً حذفت)، نخرج بهدوء
                return;
            }
        }

        // 5. تنفيذ الحذف
        try {
            // محاولة حذف الرسالة
            await reaction.message.delete();
            
            console.log(`[Owner Action] تم حذف رسالة في ${reaction.message.channel.name} بواسطة المالك.`);
        } catch (error) {
            // 10008: Unknown Message (الرسالة محذوفة أصلاً)
            if (error.code === 10008) {
                // تجاهل الخطأ لأنه يعني أن الهدف تحقق (الرسالة اختفت)
                return;
            }
            
            // تسجيل أي أخطاء أخرى (مثل نقص الصلاحيات)
            console.error('[Reaction Delete] حدث خطأ غير متوقع:', error);
        }
    },
};
