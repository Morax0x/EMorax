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
    aliases: ['إنهاء', 'end-giveaway', 'g-finish'],
    category: "Admin",
    description: "إنهاء قيفاواي نشط فوراً واختيار الفائزين.",

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let messageID, user;

        if (isSlash) {
            messageID = interactionOrMessage.options.getString('message_id');
            user = interactionOrMessage.user;
            await interactionOrMessage.deferReply({ ephemeral: true });
        } else {
            if (!args[0]) return interactionOrMessage.reply("❌ يرجى وضع آيدي رسالة القيفاواي.");
            messageID = args[0];
            user = interactionOrMessage.author;
        }

        const client = interactionOrMessage.client;

        try {
            // التحقق من وجود القيفاواي
            const giveaway = client.sql.prepare("SELECT * FROM active_giveaways WHERE messageID = ? AND isFinished = 0").get(messageID);

            if (!giveaway) {
                const msg = "❌ لم يتم العثور على قيفاواي نشط بهذا الآيدي (أو أنه انتهى بالفعل).";
                if (isSlash) await interactionOrMessage.editReply(msg);
                else await interactionOrMessage.reply(msg);
                return;
            }

            // استدعاء دالة الإنهاء (مع تفعيل الفرز الفوري)
            // نمرر true كمعامل ثالث لإجبار الإنهاء حتى لو الوقت ما خلص
            await endGiveaway(client, messageID, true); 

            const successMsg = `✅ تم إنهاء القيفاواي (ID: ${messageID}) بنجاح!`;
            if (isSlash) {
                await interactionOrMessage.editReply(successMsg);
            } else {
                await interactionOrMessage.react('✅');
            }

        } catch (error) {
            console.error("[G-End Error]", error);
            const errorMsg = "❌ حدث خطأ أثناء محاولة إنهاء القيفاواي.";
            if (isSlash) await interactionOrMessage.editReply(errorMsg);
            else await interactionOrMessage.reply(errorMsg);
        }
    }
};
