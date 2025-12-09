const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Colors, Collection } = require("discord.js");
const { calculateMoraBuff } = require('../../streak-handler.js');

const EMOJI_MORA = '<:mora:1435647151349698621>';
const MIN_BET = 25;
const MAX_BET_SOLO = 100; // 🔒 الحد الأقصى ضد البوت
const SOLO_ATTEMPTS = 7;
const COOLDOWN_MS = 1 * 60 * 60 * 1000;
const OWNER_ID = "1145327691772481577";

function formatTime(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('تخمين')
        .setDescription('تحدي البوت (فردي) أو أصدقائك (جماعي) في لعبة تخمين الرقم.')
        .addIntegerOption(option =>
            option.setName('الرهان')
                .setDescription(`المبلغ الذي تريد المراهنة به (اختياري)`)
                .setRequired(false)
                .setMinValue(MIN_BET)
        )
        .addUserOption(option => option.setName('الخصم1').setDescription('الخصم الأول (لعبة جماعية)').setRequired(false))
        .addUserOption(option => option.setName('الخصم2').setDescription('الخصم الثاني (لعبة جماعية)').setRequired(false))
        .addUserOption(option => option.setName('الخصم3').setDescription('الخصم الثالث (لعبة جماعية)').setRequired(false))
        .addUserOption(option => option.setName('الخصم4').setDescription('الخصم الرابع (لعبة جماعية)').setRequired(false))
        .addUserOption(option => option.setName('الخصم5').setDescription('الخصم الخامس (لعبة جماعية)').setRequired(false)),

    name: 'guess',
    aliases: ['خمن', 'g', 'تخمين'],
    category: "Economy",
    description: `تحدي البوت (فردي) أو تحدي أصدقائك (جماعي) في لعبة تخمين الرقم.`,

    async execute(interactionOrMessage, args) {

        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, author, client, guild, sql, channel;
        let betInput, opponents = new Collection();

        if (isSlash) {
            interaction = interactionOrMessage;
            author = interaction.member;
            client = interaction.client;
            guild = interaction.guild;
            channel = interaction.channel;
            betInput = interaction.options.getInteger('الرهان');
            for (let i = 1; i <= 5; i++) {
                const user = interaction.options.getUser(`الخصم${i}`);
                if (user) {
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    if (member) opponents.set(member.id, member);
                }
            }
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            author = message.member;
            client = message.client;
            guild = message.guild;
            channel = message.channel;
            if (args[0] && !isNaN(parseInt(args[0]))) {
                betInput = parseInt(args[0]);
                if (message.mentions.members.size > 0) opponents = message.mentions.members;
            } else if (message.mentions.members.size > 0) {
                opponents = message.mentions.members;
                if (args[1] && !isNaN(parseInt(args[1]))) betInput = parseInt(args[1]);
            }
        }

        const reply = async (payload) => {
            if (isSlash) return interaction.editReply(payload);
            return message.channel.send(payload);
        };

        const replyError = async (content) => {
             const payload = { content, ephemeral: true };
             if (isSlash) return interaction.editReply(payload);
             return message.reply(payload);
        };

        // تهيئة المتغيرات
        if (!client.activeGames) client.activeGames = new Set();
        if (!client.activePlayers) client.activePlayers = new Set();

        // 1. التحقق من اللاعب النشط (منع السبام لنفس الشخص)
        if (client.activePlayers.has(author.id)) {
            if (isSlash) return interaction.editReply({ content: "🚫 **لديك لعبة نشطة بالفعل!** أكملها أولاً." });
            return; // في الرسائل العادية نتجاهل
        }

        // 2. التحقق من القناة (لعبة واحدة لكل قناة)
        if (client.activeGames.has(channel.id)) {
            return replyError("🚫 **هناك لعبة جارية في هذه القناة.** انتظر انتهائها.");
        }

        const sql = client.sql;
        let userData = client.getLevel.get(author.id, guild.id);
        if (!userData) userData = { ...client.defaultData, user: author.id, guild: guild.id };

        // 3. التحقق من الكولداون
        const now = Date.now();
        if (author.id !== OWNER_ID) {
            const timeLeft = (userData.lastGuess || 0) + COOLDOWN_MS - now;
            if (timeLeft > 0) {
                return replyError(`🕐 انتظر **\`${formatTime(timeLeft)}\`** قبل اللعب مرة أخرى.`);
            }
        }

        // --- المراهنة التلقائية ---
        if (!betInput) {
            let proposedBet = 100;
            const userBalance = userData.mora;

            if (userBalance < MIN_BET) return replyError(`❌ لا تملك مورا كافية للعب (الحد الأدنى ${MIN_BET})!`);
            if (userBalance < 100) proposedBet = userBalance;

            // 🔒 حجز اللاعب والقناة
            client.activePlayers.add(author.id);
            client.activeGames.add(channel.id);

            const autoBetEmbed = new EmbedBuilder()
                .setColor(Colors.Blue)
                .setDescription(
                    `✥ المـراهـنـة التلقائية بـ **${proposedBet}** ${EMOJI_MORA} ؟\n` +
                    `✥ طريقة الاستخدام لتحديد المبلغ:\n` +
                    `\`خمن <مبلغ الرهان> [@لاعب اختياري]\``
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('guess_auto_confirm').setLabel('مـراهـنـة').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('guess_auto_cancel').setLabel('رفـض').setStyle(ButtonStyle.Danger)
            );

            const confirmMsg = await reply({ embeds: [autoBetEmbed], components: [row], fetchReply: true });
            
            const filter = i => i.user.id === author.id && (i.customId === 'guess_auto_confirm' || i.customId === 'guess_auto_cancel');
            
            try {
                const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 15000 });
                
                if (confirmation.customId === 'guess_auto_cancel') {
                    await confirmation.update({ content: '❌ تم الإلغاء.', embeds: [], components: [] });
                    // 🔓 تحرير
                    client.activeGames.delete(channel.id);
                    client.activePlayers.delete(author.id);
                    return;
                }

                if (confirmation.customId === 'guess_auto_confirm') {
                    await confirmation.deferUpdate();
                    if (!isSlash) await confirmMsg.delete().catch(() => {});
                    else await confirmation.editReply({ content: '✅', embeds: [], components: [] });

                    // إزالة حجز القناة فقط لبدء اللعبة الفعلية (اللاعب يبقى محجوزاً)
                    client.activeGames.delete(channel.id); 
                    
                    return startGuessGame(channel, author, opponents, proposedBet, client, guild, sql, replyError, reply);
                }
            } catch (e) {
                client.activeGames.delete(channel.id);
                client.activePlayers.delete(author.id);
                if (!isSlash) await confirmMsg.delete().catch(() => {});
                else await interaction.editReply({ content: '⏰ انتهى الوقت.', embeds: [], components: [] });
                return;
            }
        } else {
            // إذا حدد مبلغ، نحجزه ونبدأ
            client.activePlayers.add(author.id);
            return startGuessGame(channel, author, opponents, betInput, client, guild, sql, replyError, reply);
        }
    }
};

async function startGuessGame(channel, author, opponents, bet, client, guild, sql, replyError, replyFunction) {
    const channelId = channel.id;

    // فحص مزدوج للقناة
    if (client.activeGames.has(channelId)) {
        client.activePlayers.delete(author.id);
        const msg = "🚫 هناك لعبة نشطة بالفعل في هذه القناة!";
        if (replyFunction) await replyFunction({ content: msg, ephemeral: true });
        else channel.send(msg);
        return;
    }

    if (bet < MIN_BET) {
        client.activePlayers.delete(author.id);
        return replyError(`الحد الأدنى للرهان هو **${MIN_BET}** ${EMOJI_MORA} !`);
    }

    if (opponents.size === 0 && bet > MAX_BET_SOLO) {
        client.activePlayers.delete(author.id);
        return replyError(`🚫 **تنبيه:** الحد الأقصى للرهان في اللعب الفردي (ضد البوت) هو **${MAX_BET_SOLO}** ${EMOJI_MORA}!\n(للعب بمبالغ أكبر، تحدى لاعبين آخرين).`);
    }

    const getScore = client.getLevel;
    const setScore = client.setLevel;
    let authorData = getScore.get(author.id, guild.id);
    if (!authorData) authorData = { ...client.defaultData, user: author.id, guild: guild.id };

    if (authorData.mora < bet) {
        client.activePlayers.delete(author.id);
        return replyError(`ليس لديك مورا كافية لهذا الرهان! (رصيدك: ${authorData.mora})`);
    }

    // حجز القناة الآن
    client.activeGames.add(channelId);
    
    // تسجيل وقت اللعب لصاحب الأمر
    if (author.id !== OWNER_ID) authorData.lastGuess = Date.now();
    setScore.run(authorData);

    if (opponents.size === 0) {
        await playSolo(channel, author, bet, authorData, getScore, setScore, sql, replyFunction, client);
    } else {
        await playChallenge(channel, author, opponents, bet, authorData, getScore, setScore, sql, replyFunction, client);
    }
}

async function playSolo(channel, author, bet, authorData, getScore, setScore, sql, replyFunction, client) {
    const channelId = channel.id;
    const targetNumber = Math.floor(Math.random() * 100) + 1;
    let attempts = 0;

    // خصم الرهان
    authorData.mora -= bet;
    setScore.run(authorData);

    const startingPrize = bet * 7;
    let currentWinnings = startingPrize;
    const penaltyPerGuess = Math.floor(startingPrize / SOLO_ATTEMPTS);

    const embed = new EmbedBuilder()
        .setTitle('🎲 لعبة التخـمـين')
        .setDescription(`الرهان: **${bet}** ${EMOJI_MORA}\nالجائزة الحالية: **${currentWinnings}** ${EMOJI_MORA}\nاختر رقماً سريــاً بين 1 و 100.\nلديك **${SOLO_ATTEMPTS}** محاولات.\n\nاكتب تخمينك في الشات!`)
        .setColor("Random")
        .setImage('https://i.postimg.cc/Vs9bp19q/download-3.gif')
        .setFooter({ text: `المحاولات المتبقية: ${SOLO_ATTEMPTS}` });

    await replyFunction({ embeds: [embed] });

    const filter = (m) => m.author.id === author.id && !m.author.bot;
    const collector = channel.createMessageCollector({ filter, time: 60000, max: SOLO_ATTEMPTS });

    collector.on('collect', (msg) => {
        const guess = parseInt(msg.content);
        if (isNaN(guess)) return;

        attempts++;
        const attemptsLeft = SOLO_ATTEMPTS - attempts;

        if (guess === targetNumber) {
            // ( 🌟 الفردي: تطبيق البفات 🌟 )
            const moraMultiplier = calculateMoraBuff(author, sql);
            const finalWinnings = Math.floor(currentWinnings * moraMultiplier);

            authorData.mora += finalWinnings;
            setScore.run(authorData);

            let buffString = "";
            const buffPercent = Math.round((moraMultiplier - 1) * 100);
            if (buffPercent > 0) buffString = ` (+${buffPercent}%)`;

            const winEmbed = new EmbedBuilder()
                .setTitle(`✥ الـفـائـز ${author.displayName}!`)
                .setDescription(`✶ نجح في تخمين الرقم الصحيح **${targetNumber}**!\n\nربـح **${finalWinnings.toLocaleString()}** ${EMOJI_MORA}!${buffString}`)
                .setColor("Green")
                .setImage('https://i.postimg.cc/NfMfDwp4/download-2.gif')
                .setThumbnail(author.user.displayAvatarURL());

            channel.send({ embeds: [winEmbed] });
            collector.stop('win');

        } else if (attemptsLeft > 0) {
            currentWinnings -= penaltyPerGuess;
            if (currentWinnings < 0) currentWinnings = 0;

            const hint = guess > targetNumber ? 'أصغر 🔽' : 'أكبر 🔼';
            const hintEmbed = new EmbedBuilder()
                .setTitle(`محاولة خاطئة...`)
                .setDescription(`الـرقـم  **${hint}** من ${guess}.\nالجائزة المتبقية: **${currentWinnings}** ${EMOJI_MORA}`)
                .setColor("Orange")
                .setFooter({ text: `المحاولات المتبقية: ${attemptsLeft}` });
            channel.send({ embeds: [hintEmbed] });
        } else {
            collector.stop('lose');
        }
    });

    collector.on('end', (collected, reason) => {
        // 🔓 تحرير عند الانتهاء
        client.activeGames.delete(channelId);
        client.activePlayers.delete(author.id);

        if (reason === 'lose' || reason === 'time') {
            const loseEmbed = new EmbedBuilder()
                .setTitle(reason === 'time' ? '⏰ انتهى الوقت! لقد خسرت...' : '💔 لقد خسرت...')
                .setDescription(`انتهت المحاولات أو الوقت.\nكـان الـرقـم **${targetNumber}**.\nخسرت **${bet}** ${EMOJI_MORA}.`)
                .setColor("Red")
                .setImage('https://i.postimg.cc/SNsNdpgq/download.jpg');
            channel.send({ embeds: [loseEmbed] });
        }
    });
}

async function playChallenge(channel, author, opponents, bet, authorData, getScore, setScore, sql, replyFunction, client) {
    const channelId = channel.id;
    const requiredOpponentsIDs = opponents.map(o => o.id);

    // التحقق من الخصوم
    for (const opponent of opponents.values()) {
        if (opponent.id === author.id) {
            client.activeGames.delete(channelId);
            client.activePlayers.delete(author.id);
            return replyFunction({ content: "تتـحـدى نفـسـك؟ متوحـد انـت؟؟  <a:MugiStronk:1438795606872166462>", ephemeral: true });
        }
        if (client.activePlayers.has(opponent.id)) {
            client.activeGames.delete(channelId);
            client.activePlayers.delete(author.id);
            return replyFunction({ content: `اللاعب ${opponent.displayName} مشغول في لعبة أخرى!`, ephemeral: true });
        }
        if (opponent.user.bot) {
            client.activeGames.delete(channelId);
            client.activePlayers.delete(author.id);
            return replyFunction({ content: "لا يمكنك تحدي البوت في اللعب الجماعي!", ephemeral: true });
        }
        let opponentData = getScore.get(opponent.id, channel.guild.id);
        if (!opponentData || opponentData.mora < bet) {
            client.activeGames.delete(channelId);
            client.activePlayers.delete(author.id);
            return replyFunction({ content: `اللاعب ${opponent.displayName} لا يملك مورا كافية لهذا الرهان!`, ephemeral: true });
        }
    }

    // حجز الخصوم
    opponents.forEach(o => client.activePlayers.add(o.id));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('guess_pvp_accept').setLabel('قبول').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('guess_pvp_decline').setLabel('رفض').setStyle(ButtonStyle.Danger)
    );

    const totalPot = bet * (opponents.size + 1);

    const description = [
        `✥ قـام ${author}`,
        `✶ بدعـوتـك ${opponents.map(o => o.toString()).join(', ')}`,
        `على سـباق تخـمين الأرقـام!`,
        `مـبـلغ الـرهـان ${bet} ${EMOJI_MORA} (لكل شخص)`,
        `الجائـزة الكـبرى: **${totalPot.toLocaleString()}** ${EMOJI_MORA}`
    ].join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`🏁 تـحـدي تـخمـين الأرقـام!`)
        .setDescription(description)
        .setColor("Orange")
        .setImage('https://i.postimg.cc/Vs9bp19q/download-3.gif');

    const challengeMsg = await replyFunction({ 
        content: opponents.map(o => o.toString()).join(' '), 
        embeds: [embed], 
        components: [row], 
        fetchReply: true 
    });

    const acceptedOpponentsIDs = new Set(); 
    const challengeCollector = challengeMsg.createMessageComponentCollector({ time: 60000 });

    const startGame = async () => {
        challengeCollector.stop('started');
        
        const finalPlayers = [author];
        opponents.forEach(o => finalPlayers.push(o));
        const finalPlayerIDs = finalPlayers.map(p => p.id);

        for (const player of finalPlayers) {
            let data = getScore.get(player.id, channel.guild.id);
            if (!data) data = { ...channel.client.defaultData, user: player.id, guild: channel.guild.id };
            data.mora -= bet;
            if (player.id !== OWNER_ID && player.id !== author.id) data.lastGuess = Date.now();
            setScore.run(data);
        }
        // تحديث كولداون صاحب التحدي
        if (author.id !== OWNER_ID) {
            authorData.lastGuess = Date.now();
            setScore.run(authorData);
        }

        const targetNumber = Math.floor(Math.random() * 100) + 1;

        const gameEmbed = new EmbedBuilder()
            .setTitle('🏁 بدأ السباق!')
            .setDescription(`✶ قبل الجميع التـحدي! ابـدأوا التـخمـين!\n\nالرقم السري بين 1 و 100. أول من يخمنه يربح **${totalPot.toLocaleString()}** ${EMOJI_MORA}!\n(لديكم 60 ثانية)`)
            .setColor("Blue")
            .setImage('https://i.postimg.cc/Vs9bp19q/download-3.gif');

        await challengeMsg.edit({ content: finalPlayers.map(p => p.toString()).join(' '), embeds: [gameEmbed], components: [] });

        const filter = (m) => finalPlayerIDs.includes(m.author.id) && !isNaN(parseInt(m.content));
        const gameCollector = channel.createMessageCollector({ filter, time: 60000 });

        gameCollector.on('collect', (msg) => {
            const guess = parseInt(msg.content);
            if (isNaN(guess)) return;

            if (guess === targetNumber) {
                let winnerData = getScore.get(msg.author.id, channel.guild.id);
                
                // ( 🌟 الجماعي: بدون بفات - صافي 🌟 )
                const finalWinnings = totalPot;

                winnerData.mora += finalWinnings;
                setScore.run(winnerData);

                const winEmbed = new EmbedBuilder()
                    .setTitle(`✥ الـفـائـز ${msg.member.displayName}!`)
                    .setDescription(`✶ نجح ${msg.member} في تخمين الرقم الصحيح **${targetNumber}**!\n\nربـح الجائـزة الكـبرى **${totalPot.toLocaleString()}** ${EMOJI_MORA}!`)
                    .setColor("Green")
                    .setImage('https://i.postimg.cc/NfMfDwp4/download-2.gif')
                    .setThumbnail(msg.author.displayAvatarURL());

                channel.send({ embeds: [winEmbed] });
                gameCollector.stop('win');

            } else if (guess > targetNumber) {
                channel.send(`**${msg.member.displayName}**: أصغر 🔽!`);
            } else if (guess < targetNumber) {
                channel.send(`**${msg.member.displayName}**: أكبر 🔼!`);
            }
        });

        gameCollector.on('end', (collected, reason) => {
            // تحرير الجميع
            client.activeGames.delete(channelId);
            finalPlayers.forEach(p => client.activePlayers.delete(p.id));

            if (reason !== 'win') {
                const loseEmbed = new EmbedBuilder()
                    .setTitle('✥ انتهى الوقت!')
                    .setDescription(`لـم يتمكن أحـد من تخمين الرقم الصحيح (**${targetNumber}**).\n\nتـم إرجـاع **${bet}** ${EMOJI_MORA} إلـى جـميع الـمشاركين.`)
                    .setColor("Red")
                    .setImage('https://i.postimg.cc/SNsNdpgq/download.jpg');

                channel.send({ embeds: [loseEmbed] });

                // إرجاع الأموال
                for (const player of finalPlayers) {
                    let data = getScore.get(player.id, channel.guild.id);
                    data.mora += bet;
                    setScore.run(data);
                }
            }
        });
    };

    challengeCollector.on('collect', async i => {
        if (!requiredOpponentsIDs.includes(i.user.id)) {
            return i.reply({ content: `التحدي ليس مرسلاً لك!`, ephemeral: true });
        }

        if (i.customId === 'guess_pvp_decline') {
            challengeCollector.stop('decline');
            return i.update({
                content: `✬ رفـض ${i.member.displayName} التـحدي. تم الإلغاء.`,
                embeds: [],
                components: []
            });
        }

        if (i.customId === 'guess_pvp_accept') {
            if (!acceptedOpponentsIDs.has(i.user.id)) {
                acceptedOpponentsIDs.add(i.user.id);
                await i.reply({ content: `✦ تـم قبول التحدي!`, ephemeral: true });
                
                if (acceptedOpponentsIDs.size === requiredOpponentsIDs.length) {
                    await startGame();
                }
            } else {
                 await i.reply({ content: `أنت قبلت بالفعل!`, ephemeral: true });
            }
        }
    });

    challengeCollector.on('end', async (collected, reason) => {
        if (reason === 'decline' || reason !== 'started') {
            // تحرير الجميع عند الفشل
            client.activeGames.delete(channelId);
            client.activePlayers.delete(author.id);
            opponents.forEach(o => client.activePlayers.delete(o.id));
        }
        if (reason !== 'started' && reason !== 'decline') {
            return challengeMsg.edit({ content: `✶ انتـهـى الـوقـت لـم يقـبل الجـميع التحـدي!`, embeds: [], components: [] });
        }
    });
}
