const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ComponentType, Colors, Collection } = require('discord.js');
const { calculateMoraBuff } = require('../../streak-handler.js'); // للفردي فقط

const EMOJI_MORA = '<:mora:1435647151349698621>';
const MIN_BET = 20;
const MAX_BET_SOLO = 100; // 🔒 الحد الأقصى للفردي
const COOLDOWN_MS = 1 * 60 * 60 * 1000; // 1 ساعة
const CHAMBER_COUNT = 6;

const PULL_EMOJIS = ['🎯', '😮‍💨', '🥶', '🤯', '👑'];

function formatTime(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getMultipliers(playerCount) {
    if (playerCount === 1) return [1.2, 1.5, 2.0, 3.0, 4.0];
    return [1.1, 1.2, 1.3, 1.5, 1.8]; // للجماعي
}

function setupChambers() {
    const chambers = Array(CHAMBER_COUNT).fill(0);
    const bulletPosition = Math.floor(Math.random() * CHAMBER_COUNT);
    chambers[bulletPosition] = 1;
    return chambers;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('روليت')
        .setDescription('لعبة الروليت الروسية (فردي أو جماعي).')
        .addIntegerOption(option => 
            option.setName('الرهان')
                .setDescription('مبلغ الرهان (اختياري)')
                .setMinValue(MIN_BET)
                .setRequired(false))
        .addUserOption(option => option.setName('الخصم1').setDescription('تحدي لاعب آخر').setRequired(false))
        .addUserOption(option => option.setName('الخصم2').setDescription('تحدي لاعب آخر').setRequired(false))
        .addUserOption(option => option.setName('الخصم3').setDescription('تحدي لاعب آخر').setRequired(false))
        .addUserOption(option => option.setName('الخصم4').setDescription('تحدي لاعب آخر').setRequired(false))
        .addUserOption(option => option.setName('الخصم5').setDescription('تحدي لاعب آخر').setRequired(false)),

    name: 'roulette',
    aliases: ['روليت', 'rl'],
    category: "Economy",
    description: "لعبة الروليت الروسية.",

    async execute(interactionOrMessage, args) {
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, user, guild, client, channel;
        let betInput, opponents = new Collection();

        if (isSlash) {
            interaction = interactionOrMessage;
            user = interaction.user;
            guild = interaction.guild;
            client = interaction.client;
            channel = interaction.channel;
            betInput = interaction.options.getInteger('الرهان');
            
            // جمع الخصوم
            for (let i = 1; i <= 5; i++) {
                const opp = interaction.options.getUser(`الخصم${i}`);
                if (opp) {
                    const member = await guild.members.fetch(opp.id).catch(() => null);
                    if (member && !member.user.bot && member.id !== user.id) opponents.set(member.id, member);
                }
            }
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            user = message.author;
            guild = message.guild;
            client = message.client;
            channel = message.channel;
            
            if (args[0] && !isNaN(parseInt(args[0]))) {
                betInput = parseInt(args[0]);
                opponents = message.mentions.members.filter(m => !m.user.bot && m.id !== user.id);
            }
        }

        const reply = async (payload) => {
            if (isSlash) return interaction.editReply(payload);
            return message.channel.send(payload);
        };

        const sql = client.sql;
        let userData = client.getLevel.get(user.id, guild.id);
        if (!userData) userData = { ...client.defaultData, user: user.id, guild: guild.id };

        // 1. الكولداون (للجميع ما عدا المالك إذا أردت استثناءه، هنا للكل)
        const now = Date.now();
        const timeLeft = (userData.lastRoulette || 0) + COOLDOWN_MS - now;
        // استثناء المالك: if (user.id !== 'ID_HERE' && timeLeft > 0)
        if (timeLeft > 0) {
            return reply({ content: `🕐 انتظر **\`${formatTime(timeLeft)}\`** قبل اللعب مرة أخرى.`, ephemeral: true });
        }

        // --- منطق المراهنة التلقائية ---
        if (!betInput) {
            let proposedBet = 100;
            const userBalance = userData.mora;

            if (userBalance < MIN_BET) return reply({ content: `❌ لا تملك مورا كافية للعب (الحد الأدنى ${MIN_BET})!`, ephemeral: true });
            if (userBalance < 100) proposedBet = userBalance;

            const autoBetEmbed = new EmbedBuilder()
                .setColor(Colors.Blue)
                .setDescription(
                    `✥ المـراهـنـة التلقائية بـ **${proposedBet}** ${EMOJI_MORA} ؟\n` +
                    `✥ طريقة الاستخدام لتحديد المبلغ:\n` +
                    `\`روليت <مبلغ الرهان> [@لاعبين...]\``
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rl_auto_confirm').setLabel('مـراهـنـة').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('rl_auto_cancel').setLabel('رفـض').setStyle(ButtonStyle.Danger)
            );

            const confirmMsg = await reply({ embeds: [autoBetEmbed], components: [row], fetchReply: true });
            const filter = i => i.user.id === user.id && (i.customId === 'rl_auto_confirm' || i.customId === 'rl_auto_cancel');
            
            try {
                const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 15000 });
                if (confirmation.customId === 'rl_auto_cancel') {
                    await confirmation.update({ content: '❌ تم الإلغاء.', embeds: [], components: [] });
                    return;
                }
                await confirmation.deferUpdate();
                if (!isSlash) await confirmMsg.delete().catch(() => {}); 
                else await confirmation.editReply({ content: '✅', embeds: [], components: [] });
                
                return startRoulette(channel, user, opponents, proposedBet, client, guild, sql, reply);

            } catch (e) {
                if (!isSlash) await confirmMsg.delete().catch(() => {});
                else await interaction.editReply({ content: '⏰ انتهى الوقت.', embeds: [], components: [] });
                return;
            }
        } else {
            return startRoulette(channel, user, opponents, betInput, client, guild, sql, reply);
        }
    }
};

async function startRoulette(channel, user, opponents, bet, client, guild, sql, replyFunction) {
    
    // التحقق من الرصيد
    let userData = client.getLevel.get(user.id, guild.id);
    if (!userData || userData.mora < bet) {
        return replyFunction({ content: `❌ ليس لديك مورا كافية! (رصيدك: ${userData ? userData.mora : 0})`, ephemeral: true });
    }

    const activeGames = require('../../commands/economy/roulette.js').activeGames || new Set(); // (لضمان عدم التداخل إذا كان الملف module)
    // أو نستخدم متغير global مؤقت في الملف

    // --- اللعب الجماعي (PvP) ---
    if (opponents.size > 0) {
        // التحقق من أرصدة الخصوم
        for (const opp of opponents.values()) {
            const oppData = client.getLevel.get(opp.id, guild.id);
            if (!oppData || oppData.mora < bet) {
                return replyFunction({ content: `🚫 اللاعب ${opp} لا يملك مبلغ الرهان!`, ephemeral: true });
            }
        }

        const totalPot = bet * (opponents.size + 1);
        const players = [user, ...opponents.values()];
        const playerIds = players.map(p => p.id);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rl_pvp_accept').setLabel('قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('rl_pvp_decline').setLabel('رفض').setStyle(ButtonStyle.Danger)
        );

        const embed = new EmbedBuilder()
            .setTitle('🔫 تحدي روليت جماعي!')
            .setDescription(`**${user}** يتحدى **${opponents.map(o => o.displayName).join(', ')}**!\n\n💰 الرهان: **${bet}** ${EMOJI_MORA} (لكل لاعب)\n🏆 الجائزة: **${totalPot}** ${EMOJI_MORA}\n\nلديك 60 ثانية للقبول.`)
            .setColor(Colors.Gold);

        const msg = await replyFunction({ content: opponents.map(o => o.toString()).join(' '), embeds: [embed], components: [row], fetchReply: true });
        
        // (منطق اللعب الجماعي - مختصر لعدم الإطالة، نفس السابق ولكن بدون بفات)
        const accepted = new Set([user.id]);
        const collector = msg.createMessageComponentCollector({ time: 60000 });

        collector.on('collect', async i => {
            if (!playerIds.includes(i.user.id)) return i.reply({ content: "ليس لك.", ephemeral: true });
            if (i.customId === 'rl_pvp_decline') {
                collector.stop('declined');
                return i.update({ content: `❌ رفض ${i.user} التحدي.`, embeds: [], components: [] });
            }
            if (i.customId === 'rl_pvp_accept') {
                if(accepted.has(i.user.id)) return i.reply({content:"قبلت بالفعل", ephemeral:true});
                accepted.add(i.user.id);
                await i.reply({ content: `✅ قبل ${i.user} التحدي!`, ephemeral: true });
                if (accepted.size === players.length) collector.stop('start');
            }
        });

        collector.on('end', async (c, reason) => {
            if (reason !== 'start') return; // إلغاء
            
            // خصم المورا من الجميع
            for (const p of players) {
                let d = client.getLevel.get(p.id, guild.id);
                d.mora -= bet;
                if(p.id !== user.id) d.lastRoulette = Date.now(); // كولداون للخصوم
                client.setLevel.run(d);
            }
            // تحديث كولداون المضيف
            userData.lastRoulette = Date.now();
            client.setLevel.run(userData);

            // بدء اللعبة الفعلية (نفس منطق السباق السابق)
            // ... (يتم استدعاء دالة اللعب الجماعي هنا) ...
            await playMultiplayerGame(msg, players, bet, totalPot, client, guild);
        });

    } else {
        // --- اللعب الفردي (Solo) ---
        // 🔒 التحقق من الحد الأقصى
        if (bet > MAX_BET_SOLO) {
            return replyFunction({ content: `🚫 الحد الأقصى للرهان الفردي هو **${MAX_BET_SOLO}** ${EMOJI_MORA}.`, ephemeral: true });
        }

        userData.mora -= bet;
        userData.lastRoulette = Date.now();
        client.setLevel.run(userData);

        const msg = await replyFunction({ content: "جاري تحضير المسدس...", fetchReply: true });
        await playSoloRound(msg, user, bet, userData, client, sql);
    }
}

async function playSoloRound(message, user, bet, userData, client, sql) {
    let chambers = setupChambers();
    let currentTurn = 0;
    let currentMultiplier = 1.0;
    const MULTIPLIERS = getMultipliers(1);

    const updateEmbed = () => {
        return new EmbedBuilder()
            .setTitle('❖ رولــيـت (فردي)')
            .setDescription(`رصـاصـة واحـدة بالمسدس راهـن وحاول النجـاة !`)
            .setColor("Random")
            .setImage('https://i.postimg.cc/J44F9YWS/gun.gif')
            .addFields(
                { name: 'الطلقة الحالية', value: `${currentTurn + 1} / ${CHAMBER_COUNT}`, inline: true },
                { name: 'المضاعف الحالي', value: `x${currentMultiplier}`, inline: true }
            );
    };

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rl_pull').setLabel('سحب الزناد').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('rl_cashout').setLabel('انسحاب').setStyle(ButtonStyle.Success).setDisabled(true)
    );

    await message.edit({ content: " ", embeds: [updateEmbed()], components: [row] });
    
    const collector = message.createMessageComponentCollector({ filter: i => i.user.id === user.id, time: 120000 });

    collector.on('collect', async i => {
        if (i.customId === 'rl_cashout') {
            const baseWin = Math.floor(bet * currentMultiplier);
            
            // 🌟 تطبيق البف للفردي فقط 🌟
            const moraMultiplier = calculateMoraBuff(user, sql);
            const finalWin = Math.floor(baseWin * moraMultiplier);
            const buffPercent = Math.round((moraMultiplier - 1) * 100);
            const buffStr = buffPercent > 0 ? ` (${buffPercent}%)` : "";

            userData.mora += finalWin;
            client.setLevel.run(userData);

            const winEmbed = new EmbedBuilder()
                .setTitle('✅ نجاة!')
                .setDescription(
                    `✶ قـمت بـ الانسـحاب بـنجـاح\n` +
                    `ربـحت **${finalWin}** ${EMOJI_MORA} ${buffStr}`
                )
                .setColor("Green")
                .setThumbnail(user.displayAvatarURL());
            
            await i.update({ embeds: [winEmbed], components: [] });
            collector.stop();

        } else if (i.customId === 'rl_pull') {
            const shot = chambers[currentTurn];
            if (shot === 1) {
                // خسارة (المبلغ مخصوم أصلاً)
                const loseEmbed = new EmbedBuilder()
                    .setTitle('💥 بــــووم!')
                    .setDescription(
                        `✶ ضغـطت الزنـاد وانـطلـقت الرصـاصة\n` +
                        `خـسرت **${bet}** ${EMOJI_MORA}`
                    )
                    .setColor("Red")
                    .setImage('https://i.postimg.cc/3Np26Tx9/download.gif');
                
                await i.update({ embeds: [loseEmbed], components: [] });
                collector.stop();
            } else {
                // نجاة
                currentMultiplier = MULTIPLIERS[currentTurn];
                currentTurn++;

                if (currentTurn === 5) {
                    // فوز كامل
                    const baseWin = Math.floor(bet * MULTIPLIERS[4]);
                    const moraMultiplier = calculateMoraBuff(user, sql);
                    const finalWin = Math.floor(baseWin * moraMultiplier);
                    const buffPercent = Math.round((moraMultiplier - 1) * 100);
                    const buffStr = buffPercent > 0 ? ` (${buffPercent}%)` : "";

                    userData.mora += finalWin;
                    client.setLevel.run(userData);

                    const maxEmbed = new EmbedBuilder()
                        .setTitle('🏆 نجاة أسطورية!')
                        .setDescription(
                            `✶ نجـوت من جـميع الطلـقـات!\n` +
                            `ربـحت **${finalWin}** ${EMOJI_MORA} ${buffStr}`
                        )
                        .setColor("Gold")
                        .setThumbnail(user.displayAvatarURL());
                    
                    await i.update({ embeds: [maxEmbed], components: [] });
                    collector.stop();
                } else {
                    // الاستمرار
                    const currentWin = Math.floor(bet * currentMultiplier);
                    const nextWin = Math.floor(bet * MULTIPLIERS[currentTurn]);
                    
                    // تحديث الزر ليظهر المبلغ الحالي
                    const newRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('rl_pull').setLabel('سحب الزناد مجدداً').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('rl_cashout').setLabel(`انسحاب (${currentWin})`).setStyle(ButtonStyle.Success)
                    );
                    
                    const nextEmbed = updateEmbed();
                    nextEmbed.setDescription(`*كليك*... فارغة! 😅\nالمضاعف التالي: **x${MULTIPLIERS[currentTurn]}**`);
                    nextEmbed.setFields(
                        { name: 'الطلقة القادمة', value: `${currentTurn + 1} / ${CHAMBER_COUNT}`, inline: true },
                        { name: 'الربح الحالي', value: `${currentWin}`, inline: true }
                    );

                    await i.update({ embeds: [nextEmbed], components: [newRow] });
                }
            }
        }
    });
}

// دالة اللعب الجماعي (مختصرة - نفس المنطق السابق)
async function playMultiplayerGame(msg, players, bet, totalPot, client, guild) {
    // ... (نفس منطق السباق السابق، مع التأكد من عدم استخدام calculateMoraBuff)
    // ... (عند الفوز، الفائز يأخذ totalPot صافي)
    // سأضع الكود كاملاً لضمان العمل
    const gameStates = new Map();
    const MULTIPLIERS = getMultipliers(players.length);

    players.forEach(p => {
        gameStates.set(p.id, { chambers: setupChambers(), turn: 0, multiplier: 1.0, status: 'playing', player: p });
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rl_race_pull').setLabel('🔥 إطلاق').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('rl_race_out').setLabel('🏳️ انسحاب').setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder().setTitle('🔫 بدأ السباق!').setColor("Orange")
        .setDescription(`الكل دفع **${bet}**. الجائزة الكبرى: **${totalPot}**\nالبقاء للأقوى!`);

    await msg.edit({ content: " ", embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({ time: 90000 });

    collector.on('collect', async i => {
        const state = gameStates.get(i.user.id);
        if (!state || state.status !== 'playing') return i.reply({ content: "أنت خارج اللعبة.", ephemeral: true });

        if (i.customId === 'rl_race_out') {
            state.status = 'cashed_out';
            await i.reply({ content: `انسحبت بمضاعف x${state.multiplier}`, ephemeral: true });
        } else {
            const shot = state.chambers[state.turn];
            if (shot === 1) {
                state.status = 'dead'; state.multiplier = 0;
                await i.reply({ content: `💥 مت!`, ephemeral: true });
            } else {
                state.multiplier = MULTIPLIERS[state.turn]; state.turn++;
                if (state.turn === 5) { state.status = 'max_win'; await i.reply({ content: `🏆 Max Win!`, ephemeral: true }); }
                else await i.reply({ content: `نجاة! التالي x${MULTIPLIERS[state.turn]}`, ephemeral: true });
            }
        }
        if (Array.from(gameStates.values()).every(s => s.status !== 'playing')) collector.stop();
    });

    collector.on('end', () => {
        let winner = null, maxMult = 0;
        let results = [];
        for (const s of gameStates.values()) {
            if (s.multiplier > maxMult) { maxMult = s.multiplier; winner = s.player; }
            results.push(`${s.player.displayName}: ${s.status === 'dead' ? 'مات' : `x${s.multiplier}`}`);
        }

        const endEmbed = new EmbedBuilder().setColor(winner ? "Gold" : "Red");
        if (winner && maxMult > 1) {
            // 🌟 فوز جماعي: بدون بفات 🌟
            let d = client.getLevel.get(winner.id, guild.id);
            d.mora += totalPot;
            client.setLevel.run(d);
            endEmbed.setTitle(`🏆 الفائز: ${winner.displayName}`).setDescription(`ربـح **${totalPot}** ${EMOJI_MORA}\n\n${results.join('\n')}`).setThumbnail(winner.displayAvatarURL());
        } else {
            endEmbed.setTitle("💀 لا يوجد فائز").setDescription(`تم إرجاع الأموال.\n\n${results.join('\n')}`);
            players.forEach(p => { let d = client.getLevel.get(p.id, guild.id); d.mora += bet; client.setLevel.run(d); });
        }
        msg.edit({ embeds: [endEmbed], components: [] });
    });
}
