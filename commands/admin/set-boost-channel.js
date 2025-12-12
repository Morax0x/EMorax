const { PermissionsBitField, SlashCommandBuilder, ChannelType } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('تحديد-قناة-التعزيز')
        .setDescription('يحدد القناة المخصصة للتعزيز (Boost) لحساب مهام الرياكشن.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addChannelOption(option =>
            option.setName('القناة')
            .setDescription('القناة المخصصة للتعزيز')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)), 

    name: 'set-boost-channel',
    aliases: ['setboost', 'تحديد-التعزيز'],
    category: "Admin",
    description: "يحدد القناة المخصصة للتعزيز (Boost) لحساب مهام الرياكشن.",

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, guild, client, member;

        if (isSlash) {
            interaction = interactionOrMessage;
            guild = interaction.guild;
            client = interaction.client;
            member = interaction.member;
            await interaction.deferReply({ ephemeral: true });
        } else {
            message = interactionOrMessage;
            guild = message.guild;
            client = message.client;
            member = message.member;
        }

        const sql = client.sql;

        const reply = async (payload) => {
            if (isSlash) return interaction.editReply(payload);
            return message.reply(payload);
        };
        const replyError = async (content) => {
            if (isSlash) return interaction.editReply({ content, ephemeral: true });
            return message.reply({ content, ephemeral: true });
        };

        if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return replyError(`ليس لديك صلاحية الإدارة!`);
        }

        let channel;
        if (isSlash) {
            channel = interaction.options.getChannel('القناة');
        } else {
            channel = message.mentions.channels.first() || guild.channels.cache.get(args[0]);
            if (!channel) {
                return replyError("الاستخدام: `-setboost <#channel>`");
            }
        }

        if (channel.type !== ChannelType.GuildText) {
            return replyError("الرجاء تحديد قناة نصية فقط.");
        }

        try {
            // حفظ الآيدي في عمود جديد اسمه boostChannelID
            sql.prepare("INSERT INTO settings (guild, boostChannelID) VALUES (?, ?) ON CONFLICT(guild) DO UPDATE SET boostChannelID = excluded.boostChannelID")
               .run(guild.id, channel.id);

            return reply(`✅ تم تحديد قناة التعزيز بنجاح: ${channel}\nالآن سيتم احتساب مهمة الرياكشن في هذه القناة.`);
        } catch (err) {
            console.error("Set Boost Channel Error:", err);
            return replyError("حدث خطأ أثناء حفظ الإعدادات. تأكد من تحديث قاعدة البيانات.");
        }
    }
};
