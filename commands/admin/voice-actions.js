const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('صوت')
        .setDescription('التحكم في تواجد البوت الصوتي.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(sub => sub.setName('دخول').setDescription('إدخال البوت للقناة الصوتية (24/7).'))
        .addSubcommand(sub => sub.setName('خروج').setDescription('إخراج البوت من القناة الصوتية.')),

    name: 'voice',
    category: "Admin",
    description: "التحكم في البوت الصوتي",

    async execute(interaction) {
        const isSlash = !!interaction.isChatInputCommand;
        let member, guild, client;

        if (isSlash) {
            member = interaction.member;
            guild = interaction.guild;
            client = interaction.client;
            await interaction.deferReply({ ephemeral: true });
        } else { return; }

        const sub = interaction.options.getSubcommand();

        if (sub === 'دخول') {
            const channel = member.voice.channel;
            if (!channel) return interaction.editReply("❌ يجب أن تكون في قناة صوتية أولاً.");

            try {
                joinVoiceChannel({
                    channelId: channel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: false, 
                    selfMute: false  
                });

                // ( 🌟 تم حذف كود تغيير الحالة إلى Streaming من هنا 🌟 )
                // ( الآن ستبقى الفقاعة كما هي ولن تتغير )

                return interaction.editReply(`✅ **تم الدخول!**\n- القناة: ${channel.name}\n- المايك: مفتوح 🎙️`);
            
            } catch (error) {
                console.error(error);
                return interaction.editReply("❌ حدث خطأ في الاتصال.");
            }
        }

        if (sub === 'خروج') {
            const connection = getVoiceConnection(guild.id);
            if (!connection) return interaction.editReply("❌ أنا لست في قناة صوتية.");
            connection.destroy();
            return interaction.editReply("✅ تم الخروج.");
        }
    },
};
