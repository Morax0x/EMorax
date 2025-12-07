const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, PermissionsBitField } = require('discord.js');

const OWNER_ID = "1145327691772481577";

module.exports = {
    data: new SlashCommandBuilder()
        .setName('boss')
        .setDescription('التحكم في وحش العالم (للمالك فقط).')
        .addSubcommand(sub => 
            sub.setName('spawn')
                .setDescription('استدعاء وحش جديد')
                .addStringOption(op => op.setName('name').setDescription('اسم الوحش').setRequired(true))
                .addIntegerOption(op => op.setName('hp').setDescription('نقاط الحياة (HP)').setRequired(true))
                .addStringOption(op => op.setName('image').setDescription('رابط صورة الوحش').setRequired(false))
        )
        .addSubcommand(sub => sub.setName('kill').setDescription('قتل الوحش فوراً (إنهاء الفعالية)'))
        .addSubcommand(sub => sub.setName('end').setDescription('حذف الوحش بدون جوائز')),

    name: 'boss',
    category: "Admin",

    async execute(interaction, args) {
        if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "⛔ هذا الأمر للمالك فقط.", ephemeral: true });

        const sql = interaction.client.sql;
        const sub = interaction.options.getSubcommand();

        if (sub === 'spawn') {
            const name = interaction.options.getString('name');
            const hp = interaction.options.getInteger('hp');
            const image = interaction.options.getString('image') || 'https://i.postimg.cc/k4k3Ggq3/boss-default.png';

            // حذف أي وحش سابق
            sql.prepare("DELETE FROM world_boss WHERE guildID = ?").run(interaction.guild.id);
            sql.prepare("DELETE FROM boss_cooldowns WHERE guildID = ?").run(interaction.guild.id);

            const embed = new EmbedBuilder()
                .setTitle(`👹 **ظهر وحش العالـم: ${name}**`)
                .setDescription(`⚠️ **تحذير:** وحش ضخم يهدد السيرفر!\n\n🩸 **الصحة:** ${hp.toLocaleString()} / ${hp.toLocaleString()}\n⚔️ **الضربات:** تعاونوا لقتله!\n\n🎁 **الجوائز:** اضرب لتحصل على جوائز فورية (مورا، XP، بفات، كوبونات خصم)!`)
                .setColor(Colors.DarkRed)
                .setImage(image)
                .setFooter({ text: 'يمكنك الهجوم مرة واحدة كل ساعتين' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('boss_attack').setLabel('⚔️ هــجــوم').setStyle(ButtonStyle.Danger).setEmoji('🗡️'),
                new ButtonBuilder().setCustomId('boss_status').setLabel('حالة الوحش').setStyle(ButtonStyle.Secondary).setEmoji('ℹ️')
            );

            const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

            sql.prepare(`
                INSERT INTO world_boss (guildID, currentHP, maxHP, name, image, active, messageID, channelID) 
                VALUES (?, ?, ?, ?, ?, 1, ?, ?)
            `).run(interaction.guild.id, hp, hp, name, image, msg.id, interaction.channel.id);

            return interaction.reply({ content: `✅ تم استدعاء **${name}** بنجاح!`, ephemeral: true });
        }

        if (sub === 'kill') {
            const boss = sql.prepare("SELECT * FROM world_boss WHERE guildID = ? AND active = 1").get(interaction.guild.id);
            if (!boss) return interaction.reply({ content: "لا يوجد وحش نشط.", ephemeral: true });

            sql.prepare("UPDATE world_boss SET currentHP = 0, active = 0 WHERE guildID = ?").run(interaction.guild.id);
            
            const channel = await interaction.guild.channels.fetch(boss.channelID).catch(() => null);
            if (channel) {
                const msg = await channel.messages.fetch(boss.messageID).catch(() => null);
                if (msg) {
                    const deadEmbed = EmbedBuilder.from(msg.embeds[0])
                        .setTitle(`💀 **تم القضاء على ${boss.name}!**`)
                        .setDescription(`قام **${interaction.user.username}** بتوجيه الضربة القاضية!\nانتهت الفعالية.`)
                        .setColor(Colors.Grey);
                    await msg.edit({ embeds: [deadEmbed], components: [] });
                }
            }
            return interaction.reply({ content: "تم قتل الوحش.", ephemeral: true });
        }

        if (sub === 'end') {
            sql.prepare("DELETE FROM world_boss WHERE guildID = ?").run(interaction.guild.id);
            return interaction.reply({ content: "تم إنهاء الفعالية وحذف البيانات.", ephemeral: true });
        }
    }
};
