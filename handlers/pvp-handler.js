const { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, Colors } = require("discord.js");
const core = require('./pvp-core.js'); 
const { calculateMoraBuff } = require('../streak-handler.js'); 

// ==========================================
// 🧠 منطق ذكاء الوحش (PvE)
// ==========================================
async function processMonsterTurn(battleState, sql) {
    const monsterId = "monster";
    const playerId = battleState.turn[1]; 
    const monster = battleState.players.get(monsterId);
    const player = battleState.players.get(playerId);

    await new Promise(r => setTimeout(r, 1500)); 

    // 1. تأثيرات مستمرة (سموم وغيرها)
    const effectsLog = core.applyPersistentEffects(battleState, monsterId);
    battleState.log.push(...effectsLog);

    if (monster.hp <= 0) {
        await core.endBattle(battleState, playerId, sql, "win");
        return;
    }

    // 2. هجوم الوحش
    let damage = monster.weapon.currentDamage;
    let damageTaken = Math.floor(damage);

    // التحقق من درع اللاعب
    if (player.effects.shield > 0) {
        // إذا كان درع قوي (مثل الدوارف) أو درع عادي
        const reduction = player.effects.shield_value || 50; // القيمة الافتراضية 50%
        damageTaken = Math.floor(damageTaken * ((100 - reduction) / 100)); 
        battleState.log.push(`🛡️ درع اللاعب قلل الضرر بنسبة ${reduction}%!`);
    }

    player.hp -= damageTaken;
    battleState.log.push(`🦑 **${monster.name}** هاجمك وألحق **${damageTaken}** ضرر!`);

    // 3. تقليل عدادات التأثيرات
    Object.keys(monster.effects).forEach(e => { if (monster.effects[e] > 0) monster.effects[e]--; });
    // إزالة قيمة الدرع عند انتهاء العداد
    if (player.effects.shield === 0) player.effects.shield_value = 0;

    if (player.hp <= 0) {
        player.hp = 0;
        await core.endBattle(battleState, monsterId, sql, "win");
        return;
    }

    battleState.turn = [playerId, monsterId];
    
    const { embeds, components } = core.buildBattleEmbed(battleState, false);
    if (battleState.message) {
        await battleState.message.edit({ embeds, components }).catch(() => {});
    }
    battleState.processingTurn = false;
}

// ==========================================
// ⚔️ معالج التحدي (القبول والرفض)
// ==========================================
async function handlePvpChallenge(i, client, sql) {
    const parts = i.customId.split('_');
    const action = parts[1]; 
    const challengerId = parts[2];
    const opponentId = parts[3];
    const bet = parseInt(parts[4]);

    if (i.user.id !== opponentId && (action === 'accept' || action === 'decline')) {
        return i.reply({ content: "أنت لست الشخص المطلوب في هذا التحدي.", flags: [MessageFlags.Ephemeral] });
    }

    if ((i.user.id === challengerId || i.user.id === opponentId) && action === 'decline') {
        if (!core.activePvpChallenges.has(i.channel.id)) return i.update({ content: "انتهى وقت التحدي.", embeds: [], components: [] });
        core.activePvpChallenges.delete(i.channel.id);

        const challengerData = client.getLevel.get(challengerId, i.guild.id);
        if (challengerData) { challengerData.lastPVP = 0; client.setLevel.run(challengerData); }

        const isCancel = i.user.id === challengerId;
        const declineEmbed = new EmbedBuilder()
            .setTitle(isCancel ? '⚔️ تم إلغاء التحدي' : '🛡️ تم رفض التحدي')
            .setDescription(isCancel ? `قام ${core.cleanDisplayName(i.member.user.displayName)} بإلغاء التحدي.` : `لقد قام ${core.cleanDisplayName(i.member.user.displayName)} برفض التحدي.`)
            .setColor(isCancel ? Colors.Grey : Colors.Red);
        return i.update({ embeds: [declineEmbed], components: [] });
    }

    if (action === 'accept') {
        if (!core.activePvpChallenges.has(i.channel.id)) return i.update({ content: "انتهى وقت التحدي.", embeds: [], components: [] });

        const opponentMember = i.member;
        const challengerMember = await i.guild.members.fetch(challengerId).catch(() => null);
        
        if (!challengerMember) {
             const challengerData = client.getLevel.get(challengerId, i.guild.id);
             if (challengerData) { challengerData.lastPVP = 0; client.setLevel.run(challengerData); }
            return i.update({ content: "المتحدي غادر السيرفر.", embeds: [], components: [] });
        }

        const opponentWeapon = core.getWeaponData(sql, opponentMember);
        if (!opponentWeapon || opponentWeapon.currentLevel === 0) return i.reply({ content: `❌ أنت لست جاهزاً (تحتاج سلاح وعرق).`, flags: [MessageFlags.Ephemeral] });

        const challengerWeapon = core.getWeaponData(sql, challengerMember);
        if (!challengerWeapon || challengerWeapon.currentLevel === 0) {
            const challengerData = client.getLevel.get(challengerId, i.guild.id);
            if (challengerData) { challengerData.lastPVP = 0; client.setLevel.run(challengerData); }
            return i.update({ content: `❌ المتحدي لم يعد جاهزاً.`, embeds: [], components: [] });
        }

        core.activePvpChallenges.delete(i.channel.id);
        await i.deferUpdate(); 
        await i.editReply({ components: [] });
        const acceptEmbed = new EmbedBuilder().setTitle('🔥 تم قبول التحدي!').setColor(Colors.Green);
        await i.followUp({ embeds: [acceptEmbed] });
        await core.startPvpBattle(i, client, sql, challengerMember, opponentMember, bet);
    }
}

// ==========================================
// ⚡ معالج الأدوار والمهارات (الجزء المهم)
// ==========================================
async function handlePvpTurn(i, client, sql) {
    let battleState = core.activePvpBattles.get(i.channel.id);
    let isPvE = false;
    if (!battleState) { battleState = core.activePveBattles.get(i.channel.id); isPvE = true; }
    if (!battleState) { if (i.customId.startsWith('pvp_')) return i.update({ content: "انتهت المعركة.", components: [] }).catch(() => {}); return; }

    const attackerId = battleState.turn[0];
    const defenderId = battleState.turn[1];

    if (i.user.id !== attackerId) return i.reply({ content: "ليس دورك!", flags: [MessageFlags.Ephemeral] });

    // --- أزرار القوائم ---
    try {
        if (['pvp_action_skill', 'pvp_skill_back'].includes(i.customId) || i.customId.startsWith('pvp_skill_page_')) {
            let page = battleState.skillPage;
            if (i.customId.startsWith('pvp_skill_page_')) page = parseInt(i.customId.split('_')[3]);
            if (i.customId === 'pvp_action_skill') page = 0;
            
            const { embeds, components } = core.buildBattleEmbed(battleState, i.customId !== 'pvp_skill_back', page);
            return await i.update({ embeds, components });
        }
        
        if (i.customId.startsWith('pvp_skill_use_')) {
            const skillId = i.customId.replace('pvp_skill_use_', '');
            const attacker = battleState.players.get(attackerId);
            if (battleState.skillCooldowns[attackerId][skillId] > 0) return i.reply({ content: "المهارة في الانتظار (Cooldown)!", flags: [MessageFlags.Ephemeral] });
        }
    } catch (e) { if (e.code === 10062) return; throw e; }

    if (battleState.processingTurn) return i.reply({ content: "⌛ جاري المعالجة...", flags: [MessageFlags.Ephemeral] });
    battleState.processingTurn = true;

    try {
        await i.deferUpdate();
        const attacker = battleState.players.get(attackerId);
        const defender = battleState.players.get(defenderId);
        const attackerName = attacker.isMonster ? attacker.name : core.cleanDisplayName(attacker.member.user.displayName);
        const defenderName = defender.isMonster ? defender.name : core.cleanDisplayName(defender.member.user.displayName);

        // 1. تأثيرات البداية
        const persistentEffectsLog = core.applyPersistentEffects(battleState, attackerId);
        battleState.log.push(...persistentEffectsLog);

        if (attacker.hp <= 0) {
            attacker.hp = 0;
            await core.endBattle(battleState, defenderId, sql, "win", calculateMoraBuff);
            return; 
        }

        // 2. الكولداون
        Object.keys(attacker.effects).forEach(effect => { if (attacker.effects[effect] > 0) attacker.effects[effect]--; });
        // تنظيف قيمة الدرع اذا انتهى
        if (attacker.effects.shield === 0) attacker.effects.shield_value = 0;

        Object.keys(battleState.skillCooldowns[attackerId]).forEach(skill => { if (battleState.skillCooldowns[attackerId][skill] > 0) battleState.skillCooldowns[attackerId][skill]--; });

        // 3. الانسحاب
        if (i.customId === 'pvp_action_forfeit') {
            await core.endBattle(battleState, defenderId, sql, "forfeit", calculateMoraBuff);
            return; 
        }

        let actionLog = "";

        // =================================================
        // 🔥🔥🔥 حساب المهارات بناءً على JSON 🔥🔥🔥
        // =================================================
        if (i.customId.startsWith('pvp_skill_use_')) {
            const skillId = i.customId.replace('pvp_skill_use_', '');
            const skill = Object.values(attacker.skills).find(s => s.id === skillId);
            
            // skill.effectValue يأتي من core.js محسوباً بناءً على اللفل (Base + Increment * Level)
            const val = skill.effectValue; 
            const weaponDmg = attacker.weapon ? attacker.weapon.currentDamage : 10;

            battleState.skillCooldowns[attackerId][skillId] = core.SKILL_COOLDOWN_TURNS + 1; 

            switch (skillId) {
                // --- مهارات الشفاء والنسب المئوية ---
                case 'skill_healing': // % من الماكس HP
                    const healAmount = Math.floor(attacker.maxHp * (val / 100));
                    attacker.hp = Math.min(attacker.maxHp, attacker.hp + healAmount);
                    actionLog = `❤️‍🩹 ${attackerName} شفا نفسه بـ **${healAmount}** HP!`;
                    break;
                
                case 'skill_cleanse': // % شفاء + إزالة سموم
                    attacker.effects.poison = 0; attacker.effects.weaken = 0;
                    const cleanseAmt = Math.floor(attacker.maxHp * (val / 100));
                    attacker.hp = Math.min(attacker.maxHp, attacker.hp + cleanseAmt);
                    actionLog = `✨ ${attackerName} تطهر واستعاد **${cleanseAmt}** HP.`;
                    break;

                // --- مهارات الدروع والتعزيز ---
                case 'skill_shielding': // % تقليل ضرر
                    attacker.effects.shield = 2;
                    attacker.effects.shield_value = val; // تخزين نسبة الحماية (مثلاً 15% -> 45%)
                    actionLog = `🛡️ ${attackerName} رفع درعاً! (حماية ${val}%).`;
                    break;

                case 'race_dwarf_skill': // تحصين (درع قوي جداً)
                    attacker.effects.shield = 2;
                    attacker.effects.shield_value = val; // يصل لـ 50-80%
                    actionLog = `⛰️ ${attackerName} تحصن كالجبل! (حماية ${val}%).`;
                    break;

                case 'skill_buffing': // % زيادة ضرر
                    attacker.effects.buff = 2;
                    attacker.effects.buff_value = val; // تخزين نسبة الزيادة
                    actionLog = `💪 ${attackerName} زاد قوته بـ ${val}% للدور القادم!`;
                    break;

                case 'skill_weaken': // % اضعاف الخصم
                case 'race_ghoul_skill': 
                    defender.effects.weaken = 2;
                    defender.effects.weaken_value = val; // تخزين نسبة الاضعاف
                    actionLog = `📉 ${attackerName} أضعف هجوم الخصم القادم بـ ${val}%!`;
                    break;

                case 'skill_rebound': // % عكس الضرر
                     attacker.effects.rebound_active = 2;
                     attacker.effects.rebound_value = val;
                     actionLog = `🔄 ${attackerName} جهز الارتداد العكسي (${val}%)!`;
                     break;

                case 'skill_dispel': // إزالة كل شيء
                    defender.effects.shield = 0; defender.effects.buff = 0; defender.effects.rebound_active = 0;
                    actionLog = `💨 ${attackerName} بدّد سحر الخصم!`;
                    break;

                case 'skill_poison': // ضرر فوري + سم
                case 'race_dark_elf_skill':
                    defender.effects.poison = 4; // عدد الأدوار
                    // الضرر الفوري = ضرر السلاح + القيمة الأساسية للمهارة
                    const poisonInitDmg = Math.floor(weaponDmg + val);
                    defender.hp -= poisonInitDmg;
                    actionLog = `☠️ ${attackerName} سمم الخصم! (**${poisonInitDmg}** ضرر + سم مستمر).`;
                    break;

                // --- مهارات الضرر الصافي (True Damage) ---
                case 'race_dragon_skill': 
                    // يتجاهل الدرع كلياً، ضرر ثابت يعتمد على تطوير المهارة فقط
                    defender.hp -= val;
                    actionLog = `🔥 ${attackerName} أطلق نفس التنين! (**${val}** ضرر حقيقي).`;
                    break;

                // --- مهارات تعتمد على السلاح + بونص (Weapon + Flat Bonus) ---
                case 'race_demon_skill': // عهد الدم (ضرر عالي + خصم HP)
                    const demonDmg = Math.floor(weaponDmg + val); // السلاح + 50 (مثلاً)
                    defender.hp -= demonDmg;
                    const recoil = Math.floor(attacker.hp * 0.10); // خصم 10% من الدم الحالي
                    attacker.hp -= recoil;
                    actionLog = `🩸 ${attackerName} ضحى بدمه (${recoil}) ليضرب بقوة **${demonDmg}**!`;
                    break;

                case 'race_seraphim_skill': // حكم سماوي (ضرر + شفاء)
                case 'race_vampire_skill': // التهام
                    const drainDmg = Math.floor(weaponDmg + val);
                    defender.hp -= drainDmg;
                    // الشفاء نسبة من الضرر (مثلاً 30-50%)
                    const drainHeal = Math.floor(drainDmg * 0.4); 
                    attacker.hp = Math.min(attacker.maxHp, attacker.hp + drainHeal);
                    actionLog = `🦇 ${attackerName} امتص حياة الخصم! (**${drainDmg}** ضرر، +${drainHeal} HP).`;
                    break;

                case 'race_elf_skill': // رمية مزدوجة
                    // المعادلة: (السلاح + قيمة المهارة)
                    // بما أن الوصف يقول "رمية مزدوجة"، سنجعلها تبدو كضربتين في السجل
                    const elfTotalDmg = Math.floor(weaponDmg + val);
                    const hit1 = Math.floor(elfTotalDmg / 2);
                    const hit2 = elfTotalDmg - hit1;
                    defender.hp -= elfTotalDmg;
                    actionLog = `🏹 ${attackerName} أطلق سهمين! (${hit1} + ${hit2} = **${elfTotalDmg}** ضرر).`;
                    break;

                case 'skill_gamble': // مقامرة (RNG)
                    // Win: 150% من السلاح (val هو 150)
                    // Lose: 25% من السلاح
                    let gambleDmg = 0;
                    if (Math.random() < 0.5) {
                        gambleDmg = Math.floor(weaponDmg * (val / 100)); // Weapon * 1.5
                        actionLog = `🎲 ${attackerName} قامر وربح! ضربة ساحقة **${gambleDmg}**!`;
                    } else {
                        gambleDmg = Math.floor(weaponDmg * 0.25);
                        actionLog = `🎲 ${attackerName} خسر الرهان... خدش بسيط **${gambleDmg}**.`;
                    }
                    defender.hp -= gambleDmg;
                    break;
                
                case 'race_spirit_skill': // اختراق
                     attacker.effects.penetrate = 2; // التأثير للدور القادم (الهجوم العادي)
                     actionLog = `👻 ${attackerName} أصبح شبحياً! (الهجوم القادم يتجاهل الدروع).`;
                     break;

                // الافتراضي (أي مهارة هجومية أخرى): سلاح + قيمة المهارة
                default:
                    const genericDmg = Math.floor(weaponDmg + val);
                    defender.hp -= genericDmg;
                    actionLog = `⚔️ ${attackerName} استخدم ${skill.name} وألحق **${genericDmg}** ضرر!`;
                    break;
            }
            battleState.log.push(actionLog);
        }

        // 5. الهجوم العادي (ATTACK)
        if (i.customId === 'pvp_action_attack') {
            if (!attacker.weapon || attacker.weapon.currentLevel === 0) {
                 battleState.log.push(`❌ ${attackerName} يحاول الهجوم بلا سلاح!`);
            } else {
                let damage = attacker.weapon.currentDamage;
                
                // تطبيق البف (زيادة الضرر)
                if (attacker.effects.buff > 0) {
                    const buffPercent = attacker.effects.buff_value || 10;
                    damage = Math.floor(damage * (1 + (buffPercent / 100)));
                }
                // تطبيق الضعف (تقليل الضرر)
                if (attacker.effects.weaken > 0) {
                    const weakenPercent = attacker.effects.weaken_value || 10;
                    damage = Math.floor(damage * (1 - (weakenPercent / 100)));
                }

                let damageTaken = Math.floor(damage);

                // تطبيق اختراق الدروع
                if (attacker.effects.penetrate > 0) {
                    battleState.log.push(`👻 ${attackerName} اخترق الدفاعات!`);
                    attacker.effects.penetrate = 0; // استهلاك
                } 
                // حساب الدرع
                else if (defender.effects.shield > 0) {
                    const shieldPercent = defender.effects.shield_value || 15;
                    damageTaken = Math.floor(damageTaken * (1 - (shieldPercent / 100)));
                }

                defender.hp -= damageTaken;
                battleState.log.push(`⚔️ ${attackerName} هاجم وألحق **${damageTaken}** ضرر!`);

                // الارتداد العكسي
                if (defender.effects.rebound_active > 0) {
                    const reboundPercent = defender.effects.rebound_value || 15;
                    const reboundDamage = Math.floor(damageTaken * (reboundPercent / 100));
                    if (reboundDamage > 0) {
                        attacker.hp -= reboundDamage;
                        battleState.log.push(`🔄 ${defenderName} رد **${reboundDamage}** ضرر!`);
                    }
                }
            }
        }

        // 6. التحقق من الفوز
        if (defender.hp <= 0) {
            defender.hp = 0;
            const { embeds, components } = core.buildBattleEmbed(battleState);
            await i.editReply({ embeds, components });
            await core.endBattle(battleState, attackerId, sql, "win", calculateMoraBuff);
            return;
        }
        if (attacker.hp <= 0) {
            attacker.hp = 0;
            const { embeds, components } = core.buildBattleEmbed(battleState);
            await i.editReply({ embeds, components });
            await core.endBattle(battleState, defenderId, sql, "win", calculateMoraBuff);
            return;
        }

        // 7. تبديل الدور
        battleState.turn = [defenderId, attackerId];
        const { embeds, components } = core.buildBattleEmbed(battleState, false);
        await i.editReply({ embeds, components });

        if (isPvE && battleState.turn[0] === "monster") {
            processMonsterTurn(battleState, sql); 
        } else {
            battleState.processingTurn = false;
        }

    } catch (err) {
        console.error("[PvP Handler Error]", err);
        if (!i.replied) await i.followUp({ content: "حدث خطأ.", flags: [MessageFlags.Ephemeral] }).catch(() => {});
    } finally {
        if (battleState && (!isPvE || battleState.turn[0] !== "monster")) {
            battleState.processingTurn = false;
        }
    }
}

// ==========================================
// 🎮 الموجه الرئيسي
// ==========================================
async function handlePvpInteraction(i, client, sql) {
    try {
        if (i.customId.startsWith('pvp_accept_') || i.customId.startsWith('pvp_decline_')) {
            await handlePvpChallenge(i, client, sql);
        } else {
            await handlePvpTurn(i, client, sql);
        }
    } catch (error) {
        if (error.code === 10062) return; 
        console.error("[PvP Handler] Critical Error:", error);
    }
}

module.exports = {
    handlePvpInteraction,
    activePvpChallenges: core.activePvpChallenges,
    activePvpBattles: core.activePvpBattles,
};
