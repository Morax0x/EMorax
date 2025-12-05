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
    aliases: ['g-reroll'],
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
                // (true تعني force reroll حتى لو لم يكن منتهياً)
                await endGiveaway(client, manualID, true); 
                return reply({ content: `✅ تم طلب إعادة السحب للقيفاواي: ${manualID}` });
            } catch (err) {
                console.error(err);
                return reply({ content: `❌ حدث خطأ. تأكد من الآيدي وأن القيفاواي مسجل في قاعدة البيانات.` });
            }
        }

        // 2. إذا لم يدخل آيدي، اعرض القائمة المنسدلة
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        // جلب القيفاوايات المنتهية + المعلقة التي انتهى وقتها
        const giveaways = sql.prepare(`
            SELECT * FROM active_giveaways 
            WHERE (isFinished = 1 OR endsAt <= ?) AND endsAt > ? 
            ORDER BY endsAt DESC LIMIT 25
        `).all(Date.now(), sevenDaysAgo);

        if (!giveaways || giveaways.length === 0) {
            return reply({ content: "❌ لا يوجد أي قيفاوايز حديثة لعمل ريرول لها.\nجرب وضع الآيدي يدوياً: `/ريرول message_id:123...`" });
        }

        const options = giveaways.map(g => {
            const endsDate = getKSADateString(g.endsAt);
            const status = g.isFinished ? "منتهي" : "معلق";
            return new StringSelectMenuOptionBuilder()
                .setLabel(g.prize.substring(0, 100))
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
