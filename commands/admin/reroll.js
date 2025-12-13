const { PermissionsBitField, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, SlashCommandBuilder } = require("discord.js");
const { endGiveaway } = require('../../handlers/giveaway-handler.js'); 
const { getKSADateString } = require('../../streak-handler.js'); 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ريرول')
        .setDescription('اختيار فائز جديد أو إنهاء قيفاواي معلق.')
        .addStringOption(option => 
            option.setName('message_id')
                .setDescription('آيدي رسالة القيفاواي (اختياري، إذا لم تختر من القائمة)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

    name: 'reroll',
    aliases: ['g-reroll', 'اعادة-سحب'],
    category: "Admin", 
    description: 'اختيار فائز جديد أو إنهاء قيفاواي معلق.',

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, guild, client, member, manualID;

        if (isSlash) {
            interaction = interactionOrMessage;
            guild = interaction.guild;
            client = interaction.client;
            member = interaction.member;
            manualID = interaction.options.getString('message_id');
            await interaction.deferReply({ ephemeral: true }); 
        } else {
            message = interactionOrMessage;
            guild = message.guild;
            client = message.client;
            member = message.member;
            manualID = args[0];
        }

        const sql = client.sql;

        const reply = async (payload) => {
            if (typeof payload === 'string') payload = { content: payload };
            if (isSlash) {
                payload.ephemeral = true;
                return interaction.editReply(payload);
            } else {
                return message.reply(payload);
            }
        };

        if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return reply({ content: "❌ ليس لديك صلاحيات." });
        }

        // 1. إذا تم إدخال الآيدي يدوياً، نفذ الريرول فوراً
        if (manualID) {
            try {
                // نستخدم endGiveaway مع force: true لعمل Reroll كامل (اختيار فائزين جدد وتوزيع الجوائز)
                await endGiveaway(client, manualID, true); 
                return reply({ content: `✅ تم طلب إعادة السحب للقيفاواي: ${manualID}` });
            } catch (err) {
                console.error(err);
                return reply({ content: `❌ حدث خطأ. تأكد من الآيدي وأن القيفاواي مسجل في قاعدة البيانات.` });
            }
        }

        // 2. إذا لم يدخل آيدي، اعرض القائمة المنسدلة
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        // جلب القيفاوايات المنتهية + المعلقة التي انتهى وقتها (لآخر 7 أيام)
        const giveaways = sql.prepare(`
            SELECT * FROM active_giveaways 
            WHERE (isFinished = 1 OR endsAt <= ?) AND endsAt > ? 
            ORDER BY endsAt DESC LIMIT 25
        `).all(Date.now(), sevenDaysAgo);

        if (!giveaways || giveaways.length === 0) {
            return reply({ content: "❌ لا يوجد أي قيفاوايز حديثة لعمل ريرول لها.\nجرب وضع الآيدي يدوياً: `/ريرول message_id:123...`" });
        }

        const options = giveaways.map(g => {
            // محاولة تنسيق التاريخ، مع وضع افتراضي في حال فشل الدالة المساعدة
            let endsDate = "تاريخ غير معروف";
            try {
                if (typeof getKSADateString === 'function') {
                    endsDate = getKSADateString(g.endsAt);
                } else {
                    endsDate = new Date(g.endsAt).toLocaleDateString('en-US');
                }
            } catch (e) {}

            const status = g.isFinished ? "منتهي" : "معلق";
            
            // التأكد من طول النص لا يتجاوز الحدود
            let label = g.prize || "جائزة مجهولة";
            if (label.length > 100) label = label.substring(0, 97) + "...";

            return new StringSelectMenuOptionBuilder()
                .setLabel(label)
                .setValue(g.messageID)
                .setDescription(`[${status}] (ID: ${g.messageID}) - ${endsDate}`)
                .setEmoji(g.isFinished ? '✅' : '⏳');
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('g_reroll_select')
            .setPlaceholder('اختر القيفاواي الذي تريد عمل ريرول له...')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await reply({
            content: "الرجاء اختيار قيفاواي من القائمة أدناه (أو استخدم الأمر مع الآيدي مباشرة):",
            components: [row],
        });
    }
};
