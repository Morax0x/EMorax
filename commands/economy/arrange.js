const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const path = require('path');

// محاولة استدعاء ملف الهاندلر لحساب البفات
let streakHandler;
try {
    streakHandler = require('../../streak-handler.js');
} catch (e) {
    console.warn("⚠️ لم يتم العثور على streak-handler.js في المسار المتوقع.");
}

// 1. قائمة اللاعبين النشطين (لمنع السبام)
const activePlayers = new Set();
const cooldowns = new Map();

// 2. آيدي المالك (للتجاوز)
const OWNER_ID = "1145327691772481577";

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
    // ⬇️ بيانات السلاش كوماند
    data: new SlashCommandBuilder()
        .setName('arrange')
        .setDescription('لعبة ترتيب الأرقام (رهان)')
        .addIntegerOption(option => 
            option.setName('amount')
                .setDescription('مبلغ الرهان')
                .setRequired(false)
                .setMinValue(20)
        ),

    name: 'arrange',
    aliases: ['رتب', 'ترتيب'],
    category: "Economy", // ✅ تمت الإضافة: ضروري جداً ليعمل في الكازينو بدون بريفكس
    description: 'لعبة ترتيب الأرقام (رهان)',
    
    async execute(interactionOrMessage, args) {
        
        const isSlash = !!interactionOrMessage.isChatInputCommand;
        let interaction, message, user, guild, channel, betArg;

        // تجهيز المتغيرات
        if (isSlash) {
            interaction = interactionOrMessage;
            user = interaction.user;
            guild = interaction.guild;
            channel = interaction.channel;
            betArg = interaction.options.getInteger('amount');
            await interaction.deferReply();
        } else {
            message = interactionOrMessage;
            user = message.author;
            guild = message.guild;
            channel = message.channel;
            betArg = args[0] ? parseInt(args[0]) : null;
        }

        const userId = user.id;
        const guildId = guild.id;
        
        // دالة الرد الموحدة
        const reply = async (payload) => {
            if (isSlash) return interaction.editReply(payload);
            return message.channel.send(payload);
        };

        const replyError = async (content) => {
            const payload = { content: content };
            if (isSlash) return interaction.editReply(payload);
            return message.reply(payload);
        };

        // التحقق من قاعدة البيانات
        const client = isSlash ? interaction.client : message.client;
        if (!client.sql) return replyError("❌ خطأ: قاعدة البيانات غير متصلة.");
        
        const db = client.sql; 
        const MORA_EMOJI = client.EMOJI_MORA || '<:mora:1435647151349698621>';

        const clearActive = () => activePlayers.delete(userId);

        // ============================================================
        //  1. التحقق من السبام
        // ============================================================
        if (activePlayers.has(userId)) {
            return replyError("🚫 **لديك عملية نشطة بالفعل!** أكمل اللعبة أو الرهان الحالي أولاً.");
        }

        // ============================================================
        //  2. التحقق من الكولداون (باستثناء المالك)
        // ============================================================
        if (userId !== OWNER_ID) {
            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId) + 3600000;
                if (Date.now() < expirationTime) {
                    const timeLeft = (expirationTime - Date.now()) / 1000 / 60;
                    return replyError(`<:stop:1436337453098340442> **ريــلاكــس!** يمكنك اللعب مجدداً بعد **${timeLeft.toFixed(0)} دقيقة**.`);
                }
            }
        }

        // ============================================================
        //  3. حجز اللاعب
        // ============================================================
        activePlayers.add(userId);


        // --- دالة تشغيل اللعبة ---
        const startGame = async (finalBetAmount) => {
            try {
                // التحقق من الرصيد
                const userCheck = db.prepare('SELECT mora FROM levels WHERE user = ? AND guild = ?').get(userId, guildId);
                if (!userCheck || userCheck.mora < finalBetAmount) {
                      clearActive(); 
                      return replyError(`💸 **رصيدك غير كافــي!** <:mirkk:1435648219488190525>`);
                }
                
                // خصم المبلغ
                db.prepare('UPDATE levels SET mora = mora - ? WHERE user = ? AND guild = ?').run(finalBetAmount, userId, guildId);

                // تفعيل الكولداون
                if (userId !== OWNER_ID) {
                    cooldowns.set(userId, Date.now());
                }

                const numbersCount = 9;
                const randomNumbers = [];
                while (randomNumbers.length < numbersCount) {
                    let n = getRandomInt(1, 99);
                    if (!randomNumbers.includes(n)) randomNumbers.push(n);
                }

                const sortedSolution = [...randomNumbers].sort((a, b) => a - b);
                let currentStep = 0; 

                const buttons = randomNumbers.map(num => 
                    new ButtonBuilder()
                        .setCustomId(`num_${num}`)
                        .setLabel(`${num}`)
                        .setStyle(ButtonStyle.Secondary)
                );

                const shuffledButtons = buttons.sort(() => Math.random() - 0.5);
                const row1 = new ActionRowBuilder().addComponents(shuffledButtons.slice(0, 3));
                const row2 = new ActionRowBuilder().addComponents(shuffledButtons.slice(3, 6));
                const row3 = new ActionRowBuilder().addComponents(shuffledButtons.slice(6, 9));

                const gameEmbed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setThumbnail(user.displayAvatarURL())
                    .setTitle('❖ رتب الأرقام من الأصغر للأكبر')
                    .setDescription(`❖ الرهان: **${finalBetAmount} ${MORA_EMOJI}**\nاضغط الأزرار بالترتيب الصحيح قبل انتهاء الوقت!`)
                    .setFooter({ text: '❖ لــديــك 25 ثـانيــة' });

                const gameMsg = isSlash 
                    ? await interaction.editReply({ content: '', embeds: [gameEmbed], components: [row1, row2, row3] })
                    : await message.channel.send({ embeds: [gameEmbed], components: [row1, row2, row3] });

                const startTime = Date.now();
                const collector = gameMsg.createMessageComponentCollector({ 
                    componentType: ComponentType.Button, 
                    time: 25000 
                });

                const updateButtonInRows = (customId, style, disabled = false) => {
                    const rows = [row1, row2, row3];
                    for (const row of rows) {
                        const btnIndex = row.components.findIndex(b => b.data.custom_id === customId);
                        if (btnIndex !== -1) {
                            row.components[btnIndex].setStyle(style);
                            if (disabled) row.components[btnIndex].setDisabled(true);
                            return;
                        }
                    }
                };

                const disableAll = (style) => {
                    [row1, row2, row3].forEach(row => {
                        row.components.forEach(btn => {
                            btn.setDisabled(true);
                            if (btn.data.style === ButtonStyle.Secondary) btn.setStyle(style);
                        });
                    });
                };

                collector.on('collect', async i => {
                    if (i.user.id !== userId) return i.reply({ content: 'هذه اللعبة ليست لك!', ephemeral: true });

                    const clickedNum = parseInt(i.customId.split('_')[1]);
                    const correctNum = sortedSolution[currentStep];

                    if (clickedNum === correctNum) {
                        currentStep++;
                        updateButtonInRows(i.customId, ButtonStyle.Success, true);

                        if (currentStep === sortedSolution.length) {
                            collector.stop('win');
                        } else {
                            await i.update({ components: [row1, row2, row3] });
                        }
                    } else {
                        updateButtonInRows(i.customId, ButtonStyle.Danger, false);
                        collector.stop('wrong');
                        await i.update({ components: [row1, row2, row3] });
                    }
                });

                collector.on('end', async (collected, reason) => {
                    clearActive(); 

                    try {
                        if (reason === 'win') {
                            const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
                            
                            let moraMultiplier = 1.0;
                            // التأكد من تمرير العضو الصحيح (member)
                            const memberObj = isSlash ? interaction.member : message.member;

                            if (streakHandler && streakHandler.calculateMoraBuff) {
                                moraMultiplier = streakHandler.calculateMoraBuff(memberObj, db);
                            }

                            const baseProfit = finalBetAmount; 
                            const totalProfit = Math.floor(baseProfit * moraMultiplier); 
                            const totalPrize = finalBetAmount + totalProfit; 
                            
                            const buffPercent = Math.round((moraMultiplier - 1) * 100);
                            let buffText = "";
                            if (buffPercent > 0) buffText = ` (+${buffPercent}%)`;

                            db.prepare('UPDATE levels SET mora = mora + ? WHERE user = ? AND guild = ?').run(totalPrize, userId, guildId);

                            const winEmbed = new EmbedBuilder()
                                .setColor('#00FF00')
                                .setThumbnail(user.displayAvatarURL())
                                .setTitle('❖ كفــوو عليك <:2BCrikka:1437806481071411391>')
                                .setDescription(`✶ جبتها صــح!\n⏱️ الوقت: **${timeTaken}ث**\n💰 ربـحـت: **${totalProfit}** ${MORA_EMOJI}${buffText}`);

                            disableAll(ButtonStyle.Success);
                            await gameMsg.edit({ embeds: [winEmbed], components: [row1, row2, row3] }).catch(() => {});

                        } else {
                            let reasonText = reason === 'wrong' ? 'ضغطت رقم غلط!' : ' انتهى الوقت!';
                            const loseEmbed = new EmbedBuilder()
                                .setColor('#FF0000')
                                .setThumbnail(user.displayAvatarURL())
                                .setTitle(' خـسـرت <:catla:1437335118153781360>!')
                                .setDescription(`${reasonText}\nراحت عليك **${finalBetAmount} ${MORA_EMOJI}**`);

                            disableAll(ButtonStyle.Secondary);
                            await gameMsg.edit({ embeds: [loseEmbed], components: [row1, row2, row3] }).catch(() => {});
                        }
                    } catch (err) {
                        console.error("خطأ أثناء إنهاء اللعبة:", err);
                    }
                });
            } catch (err) {
                clearActive();
                console.error("خطأ أثناء بدء اللعبة:", err);
                replyError("حدث خطأ أثناء بدء اللعبة.");
            }
        };

        // ============================================================
        //  بداية معالجة الأمر
        // ============================================================
        let finalBetAmount = betArg;

        // 1. إذا حدد رقم مباشرة
        if (finalBetAmount && !isNaN(finalBetAmount)) {
            if (finalBetAmount <= 0) {
                clearActive(); return replyError("❌ **حدد مبلغ رهان صحيح.**");
            }
            if (finalBetAmount > 100) {
                clearActive(); return replyError(`❌ **الحد الأقصى للرهان هو 100 ${MORA_EMOJI}**`);
            }
            return startGame(finalBetAmount);
        }

        // 2. نظام الرهان التلقائي
        let userData = db.prepare('SELECT mora FROM levels WHERE user = ? AND guild = ?').get(userId, guildId);
        
        if (!userData || userData.mora < 1) {
            clearActive();
            return replyError("💸 **ليس لديك مورا كافية للعب!** <:catla:1437335118153781360>");
        }

        let proposedBet = 100;
        if (userData.mora < 100) proposedBet = userData.mora;

        const autoBetEmbed = new EmbedBuilder()
            .setColor('#2F3136')
            .setDescription(`**هل تريد المراهنة تلقائياً بـ ${proposedBet} ${MORA_EMOJI} ؟**\n<:2BCrikka:1437806481071411391>`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('arrange_auto_confirm').setLabel('مراهنة').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('arrange_auto_cancel').setLabel('إلغـاء').setStyle(ButtonStyle.Danger)
        );

        const confirmMsg = await reply({ embeds: [autoBetEmbed], components: [row], fetchReply: true });
        
        const filter = i => i.user.id === userId && (i.customId === 'arrange_auto_confirm' || i.customId === 'arrange_auto_cancel');
        
        try {
            const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 15000 });

            if (confirmation.customId === 'arrange_auto_cancel') {
                clearActive(); 
                await confirmation.update({ content: '❌ تم الإلغاء.', embeds: [], components: [] });
                return;
            }

            if (confirmation.customId === 'arrange_auto_confirm') {
                await confirmation.deferUpdate();
                
                // في السلاش: لا تحذف، بل اترك startGame يعدلها
                // في البريفكس: احذف ليكون الشكل أنظف
                if (!isSlash) {
                    await confirmMsg.delete().catch(() => {});
                }
                
                startGame(proposedBet);
            }

        } catch (e) {
            clearActive(); 
            const timeoutPayload = { content: '⏰ انتهى وقت الانتظار.', embeds: [], components: [] };
            if (isSlash) await interaction.editReply(timeoutPayload).catch(() => {});
            else await confirmMsg.edit(timeoutPayload).catch(() => {});
        }
    }
};
