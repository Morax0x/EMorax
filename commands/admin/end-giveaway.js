const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { endGiveaway } = require('../../handlers/giveaway-handler.js'); 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('انهاء')
        .setDescription('إنهاء قيفاواي نشط فوراً واختيار الفائزين.')
        .addStringOption(option => 
            option.setName('message_id')
                .setDescription('آيدي رسالة القيفاواي')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

    name: 'g-end',
    aliases: ['إنهاء', 'end-giveaway', 'g-finish', 'انهاء-قيف'],
    category: "Admin",
    description: "إنهاء قيفاواي نشط فوراً واختيار الفائزين.",

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let messageID;

        if (isSlash) {
            messageID = interactionOrMessage.options.getString('message_id');
            await interactionOrMessage.deferReply({ ephemeral: true });
        } else {
            if (!args[0]) return interactionOrMessage.reply("❌ يرجى وضع آيدي رسالة القيفاواي.");
            messageID = args[0];
        }

        const client = interactionOrMessage.client;

        try {
            // التحقق من وجود القيفاواي وأنه لم ينتهِ بعد
            const giveaway = client.sql.prepare("SELECT * FROM active_giveaways WHERE messageID = ?").get(messageID);

            if (!giveaway) {
                const msg = "❌ لم يتم العثور على قيفاواي بهذا الآيدي.";
                if (isSlash) await interactionOrMessage.editReply(msg);
                else await interactionOrMessage.reply(msg);
                return;
            }

            if (giveaway.isFinished === 1) {
                const msg = "⚠️ هذا القيفاواي منتهي بالفعل.";
                if (isSlash) await interactionOrMessage.editReply(msg);
                else await interactionOrMessage.reply(msg);
                return;
            }

            // استدعاء دالة الإنهاء مع تفعيل الإجبار (force = true)
            // المعامل الثالث (true) هو المهم هنا لأنه يجبر الدالة على الإنهاء حتى لو الوقت لم ينقضِ
            await endGiveaway(client, messageID, true); 

            const successMsg = `✅ تم إنهاء القيفاواي (ID: ${messageID}) واختيار الفائزين بنجاح!`;
            
            if (isSlash) {
                await interactionOrMessage.editReply(successMsg);
            } else {
                await interactionOrMessage.reply(successMsg);
            }

        } catch (error) {
            console.error("[G-End Error]", error);
            const errorMsg = "❌ حدث خطأ أثناء محاولة إنهاء القيفاواي.";
            if (isSlash) await interactionOrMessage.editReply(errorMsg);
            else await interactionOrMessage.reply(errorMsg);
        }
    }
};
