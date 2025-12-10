const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

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
    name: 'arrange',
    aliases: ['رتب', 'ترتيب'],
    description: 'لعبة ترتيب الأرقام (رهان)',
    async execute(message, args) {
        
        const userId = message.author.id;
        const guildId = message.guild.id;
        const db = message.client.sql;
        const MORA_EMOJI = message.client.EMOJI_MORA || '<:mora:1435647151349698621>';

        // دالة تنظيف اللاعب من القائمة النشطة
        const clearActive = () => activePlayers.delete(userId);

        // ============================================================
        //  1. التحقق من السبام (أول خطوة)
        // ============================================================
        if (activePlayers.has(userId)) {
            return message.reply("🚫 **لديك لعبة نشطة بالفعل!** أكمل اللعبة الحالية أولاً.").catch(() => {});
        }

        // ============================================================
        //  2. التحقق من الكولداون
        // ============================================================
        if (userId !== OWNER_ID) {
            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId) + 3600000; // 1 ساعة
                if (Date.now() < expirationTime) {
                    const timeLeft = (expirationTime - Date.now()) / 1000 / 60;
                    return message.reply(`<:stop:1436337453098340442> **ريــلاكــس!** يمكنك اللعب مجدداً بعد **${timeLeft.toFixed(0)} دقيقة**.`);
                }
            }
        }

        // حجز اللاعب فوراً
        activePlayers.add(userId);

        // --- دالة تشغيل اللعبة ---
        const startGame = async (finalBetAmount) => {
            try {
                // التحقق من الرصيد والخصم
                const userCheck = db.prepare('SELECT mora FROM levels WHERE user = ? AND guild = ?').get(userId, guildId);
                if (!userCheck || userCheck.mora < finalBetAmount) {
                      clearActive(); 
                      return message.reply(`❖ **رصيدك غير كافــي!** <:mirkk:1435648219488190525>`);
                }
                
                // خصم المبلغ
                db.prepare('UPDATE levels SET mora = mora - ? WHERE user = ? AND guild = ?').run(finalBetAmount, userId, guildId);

                // تفعيل الكولداون (لغير المالك)
                if (userId !== OWNER_ID) {
                    cooldowns.set(userId, Date.now());
                }

                // إعداد الأرقام
                const numbersCount = 9;
                const randomNumbers = [];
                while (randomNumbers.length < numbersCount) {
                    let n = getRandomInt(1, 99);
                    if (!randomNumbers.includes(n)) randomNumbers.push(n);
                }

                const sortedSolution = [...randomNumbers].sort((a, b) => a - b);
                let currentStep = 0; 

                // إنشاء الأزرار
                const buttons = randomNumbers.map(num => 
                    new ButtonBuilder()
                        .setCustomId(`num_${num}`)
                        .setLabel(`${num}`)
                        .setStyle(ButtonStyle.Secondary)
                );

                // خلط الأزرار للعرض
                const shuffledButtons = buttons.sort(() => Math.random() - 0.5);
                const row1 = new ActionRowBuilder().addComponents(shuffledButtons.slice(0, 3));
                const row2 = new ActionRowBuilder().addComponents(shuffledButtons.slice(3, 6));
                const row3 = new ActionRowBuilder().addComponents(shuffledButtons.slice(6, 9));

                const gameEmbed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setThumbnail(message.author.displayAvatarURL())
                    .setTitle('❖ رتب الأرقام من الأصغر للأكبر')
                    .setDescription(`❖ الرهان: **${finalBetAmount} ${MORA_EMOJI}**\nاضغط الأزرار بالترتيب الصحيح قبل انتهاء الوقت!`)
                    .setFooter({ text: '❖ لــديــك 25 ثـانيــة' });

                const gameMsg = await message.channel.send({ 
                    embeds: [gameEmbed], 
                    components: [row1, row2, row3] 
                });

                const startTime = Date.now();
                const collector = gameMsg.createMessageComponentCollector({ 
                    componentType: ComponentType.Button, 
                    time: 25000 
                });

                // دالة مساعدة لتحديث الأزرار في الصفوف
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

                // دالة لتعطيل كل الأزرار عند النهاية
                const disableAll = (style) => {
                    [row1, row2, row3].forEach(row => {
                        row.components.forEach(btn => {
                            btn.setDisabled(true);
                            // تغيير لون الأزرار المتبقية (التي لم تضغط)
                            if (btn.data.style === ButtonStyle.Secondary) btn.setStyle(style);
                        });
                    });
                };

                collector.on('collect', async i => {
                    if (i.user.id !== userId) return i.reply({ content: 'هذه اللعبة ليست لك!', ephemeral: true });

                    const clickedNum = parseInt(i.customId.split('_')[1]);
                    const correctNum = sortedSolution[currentStep];

                    if (clickedNum === correctNum) {
                        // إجابة صحيحة
                        currentStep++;
                        updateButtonInRows(i.customId, ButtonStyle.Success, true); // تحويل للأخضر وتعطيل

                        if (currentStep === sortedSolution.length) {
                            collector.stop('win');
                        } else {
                            await i.update({ components: [row1, row2, row3] });
                        }
                    } else {
                        // إجابة خاطئة
                        updateButtonInRows(i.customId, ButtonStyle.Danger, true); // تحويل للأحمر
                        collector.stop('wrong');
                        await i.update({ components: [row1, row2, row3] });
                    }
                });

                collector.on('end', async (collected, reason) => {
                    clearActive(); 

                    try {
                        if (reason === 'win') {
                            const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
                            
                            // حساب البفات
                            let moraMultiplier = 1.0;
                            if (streakHandler && streakHandler.calculateMoraBuff) {
                                moraMultiplier = streakHandler.calculateMoraBuff(message.member, db);
                            }

                            const baseProfit = finalBetAmount; 
                            const totalProfit = Math.floor(baseProfit * moraMultiplier); 
                            const totalPrize = finalBetAmount + totalProfit; // استرجاع الرهان + الربح
                            
                            // نص البف
                            const buffPercent = Math.round((moraMultiplier - 1) * 100);
                            let buffText = "";
                            if (buffPercent > 0) buffText = ` (+${buffPercent}%)`;

                            // إضافة الفلوس
                            db.prepare('UPDATE levels SET mora = mora + ? WHERE user = ? AND guild = ?').run(totalPrize, userId, guildId);

                            const winEmbed = new EmbedBuilder()
                                .setColor('#00FF00')
                                .setThumbnail(message.author.displayAvatarURL())
                                .setTitle('❖ كفــوو عليك <:2BCrikka:1437806481071411391>')
                                .setDescription(`✶ جبتها صــح!\n⏱️ الوقت: **${timeTaken}ث**\n💰 ربـحـت: **${totalProfit}** ${MORA_EMOJI}${buffText}`);

                            disableAll(ButtonStyle.Success);
                            await gameMsg.edit({ embeds: [winEmbed], components: [row1, row2, row3] }).catch(() => {});

                        } else {
                            let reasonText = reason === 'wrong' ? 'ضغطت رقم غلط!' : ' انتهى الوقت!';
                            const loseEmbed = new EmbedBuilder()
                                .setColor('#FF0000')
                                .setThumbnail(message.author.displayAvatarURL())
                                .setTitle(' خـسـرت <:catla:1437335118153781360>!')
                                .setDescription(`${reasonText}\nراحت عليك **${finalBetAmount} ${MORA_EMOJI}**\nالترتيب كان: \`${sortedSolution.join(' < ')}\``);

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
                message.reply("حدث خطأ أثناء بدء اللعبة.").catch(() => {});
            }
        };

        // ============================================================
        //  معالجة الأمر (تلقائي أو يدوي)
        // ============================================================
        let betAmount = parseInt(args[0]);

        // 1. إذا حدد رقم مباشرة
        if (betAmount && !isNaN(betAmount)) {
            if (betAmount <= 0) {
                clearActive(); return message.reply("❌ **حدد مبلغ رهان صحيح.**");
            }
            if (betAmount > 100) {
                clearActive(); return message.reply(`❌ **الحد الأقصى للرهان هو 100 ${MORA_EMOJI}**`);
            }
            return startGame(betAmount);
        }

        // 2. نظام الرهان التلقائي (إذا لم يحدد رقم)
        let userData = db.prepare('SELECT mora FROM levels WHERE user = ? AND guild = ?').get(userId, guildId);
        
        if (!userData || userData.mora < 1) {
            clearActive();
            return message.reply("💸 **ليس لديك مورا كافية للعب!** <:catla:1437335118153781360>");
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

        const confirmMsg = await message.reply({ embeds: [autoBetEmbed], components: [row] });
        
        const filter = i => i.user.id === userId && (i.customId === 'arrange_auto_confirm' || i.customId === 'arrange_auto_cancel');
        
        try {
            const confirmation = await confirmMsg.awaitMessageComponent({ filter, time: 15000 });

            if (confirmation.customId === 'arrange_auto_cancel') {
                clearActive(); 
                await confirmation.update({ content: '❌ تم الإلغــاء.', embeds: [], components: [] });
                return;
            }

            if (confirmation.customId === 'arrange_auto_confirm') {
                await confirmation.deferUpdate();
                await confirmMsg.delete().catch(() => {});
                startGame(proposedBet);
            }

        } catch (e) {
            clearActive(); 
            await confirmMsg.edit({ content: '⏰ انتهى وقت الانتظار.', embeds: [], components: [] }).catch(() => {});
        }
    }
};
