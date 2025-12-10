const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const cooldowns = new Map();

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
    name: 'arrange',
    aliases: ['رتب', 'ترتيب'],
    description: 'لعبة ترتيب الأرقام (رهان)',
    async execute(message, args, db) {
        
        if (cooldowns.has(message.author.id)) {
            const expirationTime = cooldowns.get(message.author.id) + 3600000;
            if (Date.now() < expirationTime) {
                const timeLeft = (expirationTime - Date.now()) / 1000 / 60;
                return message.reply(`❌ **انتظر قليلاً!** يمكنك اللعب مجدداً بعد **${timeLeft.toFixed(0)} دقيقة**.`);
            }
        }

        let betAmount = parseInt(args[0]);
        if (!betAmount || isNaN(betAmount) || betAmount <= 0) {
            return message.reply("❌ **حدد مبلغ الرهان.**");
        }

        if (betAmount > 100) {
            return message.reply("❌ **الحد الأقصى للرهان هو 100 <:mora:1435647151349698621>**");
        }

        const userId = message.author.id;
        
        // const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        // if (!user || user.balance < betAmount) return message.reply("💸 **رصيدك غير كافي!**");
        // db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(betAmount, userId);

        cooldowns.set(userId, Date.now());

        // توليد 9 أرقام عشوائية غير مكررة
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

        // خلط الأزرار وتوزيعها على 3 صفوف (3 في كل صف)
        const shuffledButtons = buttons.sort(() => Math.random() - 0.5);

        const row1 = new ActionRowBuilder().addComponents(shuffledButtons.slice(0, 3));
        const row2 = new ActionRowBuilder().addComponents(shuffledButtons.slice(3, 6));
        const row3 = new ActionRowBuilder().addComponents(shuffledButtons.slice(6, 9));

        const gameEmbed = new EmbedBuilder()
            .setColor('#FFD700')
            .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
            .setTitle('🔢 رتب الأرقام من الأصغر للأكبر')
            .setDescription(`الرهان: **${betAmount} <:mora:1435647151349698621>**\nاضغط الأزرار بالترتيب الصحيح قبل انتهاء الوقت!`)
            .setFooter({ text: 'لديك 20 ثانية' });

        const gameMsg = await message.channel.send({ 
            embeds: [gameEmbed], 
            components: [row1, row2, row3] 
        });

        const startTime = Date.now();
        const collector = gameMsg.createMessageComponentCollector({ 
            componentType: ComponentType.Button, 
            time: 20000 
        });

        collector.on('collect', async i => {
            if (i.user.id !== userId) {
                return i.reply({ content: 'هذه اللعبة ليست لك!', ephemeral: true });
            }

            const clickedNum = parseInt(i.customId.split('_')[1]);
            const correctNum = sortedSolution[currentStep];

            // دالة مساعدة لتحديث الزر في أي صف كان
            const updateButtonInRows = (customId, style, disabled = false) => {
                const rows = [row1, row2, row3];
                for (const row of rows) {
                    const btnIndex = row.components.findIndex(b => b.data.custom_id === customId);
                    if (btnIndex !== -1) {
                        row.components[btnIndex].setStyle(style);
                        if (disabled) row.components[btnIndex].setDisabled(true);
                        return; // تم التعديل ونخرج
                    }
                }
            };

            if (clickedNum === correctNum) {
                currentStep++;
                
                // تحديث الزر ليصبح أخضر
                updateButtonInRows(i.customId, ButtonStyle.Success, true);

                if (currentStep === sortedSolution.length) {
                    collector.stop('win');
                } else {
                    await i.update({ components: [row1, row2, row3] });
                }

            } else {
                // تحديث الزر ليصبح أحمر عند الخطأ
                updateButtonInRows(i.customId, ButtonStyle.Danger, false);
                collector.stop('wrong');
                await i.update({ components: [row1, row2, row3] });
            }
        });

        collector.on('end', async (collected, reason) => {
            // دالة لتعطيل كل الأزرار
            const disableAll = (style) => {
                [row1, row2, row3].forEach(row => {
                    row.components.forEach(btn => {
                        btn.setDisabled(true);
                        // إذا الزر لم يتم ضغطه مسبقاً (Secondary) نغيره للون النهائي
                        // أما الأخضر والأحمر نتركهم كما هم
                        if (btn.data.style === ButtonStyle.Secondary) {
                            btn.setStyle(style);
                        }
                    });
                });
            };

            if (reason === 'win') {
                const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
                
                // ============================================
                // مكان تحديد نسبة العرق
                // ============================================
                
                let raceBonusPercent = 0.00; // 0% افتراضياً
                
                // if (userRace === 'human') raceBonusPercent = 0.10;

                // الحسابات
                const baseProfit = betAmount; // الربح الصافي
                const extraBonus = Math.floor(baseProfit * raceBonusPercent); // مكافأة العرق
                const totalPrize = betAmount + baseProfit + extraBonus; // المبلغ المسترجع (رأس المال + الربح + المكافأة)

                // db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(totalPrize, userId);

                const winEmbed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                    .setTitle('🎉 كفوو عليك!')
                    .setDescription(`جبتها صح!\n⏱️ الوقت: **${timeTaken}ث**\n💰 الربح: **${baseProfit}** + مكافأة **${extraBonus}**\nالمجموع: **${totalPrize} <:mora:1435647151349698621>**`);

                disableAll(ButtonStyle.Success); // كل الباقي يصير أخضر
                await gameMsg.edit({ embeds: [winEmbed], components: [row1, row2, row3] });

            } else {
                let reasonText = reason === 'wrong' ? 'ضغطت رقم غلط!' : 'انتهى الوقت!';
                
                const loseEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                    .setTitle('❌ خسرت!')
                    .setDescription(`${reasonText}\nراحت عليك **${betAmount} <:mora:1435647151349698621>**\nالترتيب كان: \`${sortedSolution.join(' < ')}\``);

                disableAll(ButtonStyle.Secondary); // مجرد تعطيل
                await gameMsg.edit({ embeds: [loseEmbed], components: [row1, row2, row3] });
            }
        });
    }
};
