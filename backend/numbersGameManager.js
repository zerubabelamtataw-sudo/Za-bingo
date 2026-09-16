'use strict';

const MAX_NUMBERS = 80;
const MAX_SELECTIONS = 10;
const MAX_TICKETS = 20;

const BETTING_TIME = 30;
const DRAW_TIME = 20;
const DRAW_COUNT = 20;

const STAKES = [2, 3, 5, 10, 20, 50];

const PAYOUTS = {
    1: { 1: 6 },
    2: { 2: 20 },
    3: { 3: 90 },
    4: { 4: 160, 3: 20 },
    5: { 5: 300, 4: 30 },
    6: { 6: 1000, 5: 100, 4: 40 },
    7: { 7: 2500, 6: 250, 5: 60 },
    8: { 8: 5000, 7: 500, 6: 100 },
    9: { 9: 10000, 8: 1000, 7: 200 },
    10: { 10: 15000, 9: 1500, 8: 300 }
};

function randomInt(max) {
    return Math.floor(Math.random() * max);
}

function shuffledNumbers() {
    const numbers = Array.from(
        { length: MAX_NUMBERS },
        (_, i) => i + 1
    );

    for (let i = numbers.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }

    return numbers;
}

class NumbersGameManager {

    constructor(db) {
        this.db = db;
        this.round = null;
        this.timer = null;
        this.drawTimer = null;
        this.roundNumber = 1001;

        this.startRound();
    }

    startRound() {
        clearInterval(this.timer);
        clearInterval(this.drawTimer);

        this.round = {
            roundNumber: this.roundNumber++,
            phase: 'betting',
            seconds: BETTING_TIME,
            drawnNumbers: [],
            tickets: {},
            playerIds: new Set(),
            drawPool: shuffledNumbers(),
            drawIndex: 0
        };

        this.timer = setInterval(() => {
            this.tick();
        }, 1000);
    }

    tick() {

        if (!this.round) return;

        if (this.round.phase === 'betting') {

            this.round.seconds--;

            if (this.round.seconds <= 0) {
                this.startDrawing();
            }

            return;
        }

        if (this.round.phase === 'finished') {
            this.startRound();
        }
    }

    startDrawing() {

        if (!this.round) return;

        if (this.round.phase !== 'betting') return;

        clearInterval(this.timer);

        this.round.phase = 'drawing';
        this.round.seconds = DRAW_TIME;

        this.drawTimer = setInterval(() => {
            this.drawNumber();
        }, 1000);
    }

    async drawNumber() {

        if (!this.round) return;

        if (this.round.phase !== 'drawing') return;

        const number =
            this.round.drawPool[this.round.drawIndex++];

        if (number != null) {
            this.round.drawnNumbers.push(number);
        }

        this.round.seconds =
            Math.max(
                0,
                DRAW_TIME - this.round.drawnNumbers.length
            );

        if (
            this.round.drawnNumbers.length >=
            DRAW_COUNT
        ) {

            clearInterval(this.drawTimer);

            await this.finishRound();
        }
    }

    calculatePayout(
        selectionCount,
        matches,
        stake
    ) {

        const table =
            PAYOUTS[selectionCount];

        if (!table) return 0;

        const base =
            Number(table[matches] || 0);

        return base * (stake / 2);
    }

    async finishRound() {

        if (!this.round) return;

        if (this.round.phase === 'finished') {
            return;
        }

        clearInterval(this.drawTimer);

        this.round.phase = 'finished';
        this.round.seconds = 0;

        const drawn =
            new Set(this.round.drawnNumbers);

        const tickets =
            Object.values(this.round.tickets);

        for (const ticket of tickets) {

            const matches =
                ticket.numbers.reduce(
                    (count, number) =>
                        count +
                        (
                            drawn.has(number)
                                ? 1
                                : 0
                        ),
                    0
                );

            const payout =
                this.calculatePayout(
                    ticket.numbers.length,
                    matches,
                    ticket.stake
                );

            ticket.matches = matches;
            ticket.payout = payout;

            ticket.status =
                payout > 0
                    ? 'won'
                    : 'lost';

            if (payout > 0) {

                await this.creditWinnings(
                    ticket.playerId,
                    payout,
                    ticket.paymentSource
                );
            }
        }

        if (this.db) {

            await this.db
                .ref(
                    `numbers/rounds/${this.round.roundNumber}`
                )
                .set({
                    roundNumber:
                        this.round.roundNumber,

                    phase: 'finished',

                    drawnNumbers:
                        this.round.drawnNumbers,

                    playerCount:
                        this.round.playerIds.size,

                    ticketCount:
                        tickets.length,

                    finishedAt:
                        new Date().toISOString(),

                    tickets:
                        Object.fromEntries(
                            tickets.map(ticket => [
                                ticket.id,
                                ticket
                            ])
                        )
                });
        }

        setTimeout(() => {
            this.startRound();
        }, 3000);
    }

    async creditWinnings(
        playerId,
        amount,
        paymentSource
    ) {

        const playerRef =
            this.db.ref(
                `players/${playerId}`
            );

        const balanceName =
            paymentSource === 'bonus'
                ? 'referralBonusBalance'
                : 'balance';

        await playerRef
            .child(balanceName)
            .transaction(current =>
                Number(current || 0) +
                Number(amount)
            );
    }

    async deductStake(
        playerRef,
        amount
    ) {

        let source = null;

        await playerRef.transaction(player => {

            if (!player) return player;

            const main =
                Number(player.balance || 0);

            const bonus =
                Number(
                    player.referralBonusBalance || 0
                );

            if (main >= amount) {

                player.balance =
                    main - amount;

                source = 'main';

            } else if (bonus >= amount) {

                player.referralBonusBalance =
                    bonus - amount;

                source = 'bonus';

            } else {

                source = null;
            }

            return player;
        });

        if (!source) {
            throw new Error(
                'Insufficient balance'
            );
        }

        return source;
    }

    async buyTicket(
        playerId,
        numbers,
        stake
    ) {

        if (
            !this.round ||
            this.round.phase !== 'betting'
        ) {
            throw new Error(
                'Betting is closed'
            );
        }

        const id =
            String(playerId || '').trim();

        if (!id) {
            throw new Error(
                'Player ID required'
            );
        }

        if (
            !Array.isArray(numbers) ||
            numbers.length < 1 ||
            numbers.length > MAX_SELECTIONS
        ) {
            throw new Error(
                'Select 1–10 numbers'
            );
        }

        const cleanNumbers =
            [...new Set(
                numbers.map(Number)
            )].sort(
                (a, b) => a - b
            );

        if (
            cleanNumbers.length !==
            numbers.length
        ) {
            throw new Error(
                'Duplicate numbers are not allowed'
            );
        }

        if (
            cleanNumbers.some(
                n =>
                    !Number.isInteger(n) ||
                    n < 1 ||
                    n > MAX_NUMBERS
            )
        ) {
            throw new Error(
                'Numbers must be between 1 and 80'
            );
        }

        const numericStake =
            Number(stake);

        if (
            !STAKES.includes(numericStake)
        ) {
            throw new Error(
                'Invalid stake'
            );
        }

        const playerRef =
            this.db.ref(
                `players/${id}`
            );

        const snapshot =
            await playerRef.once('value');

        if (!snapshot.exists()) {
            throw new Error(
                'Player not found'
            );
        }

        const playerTickets =
            Object.values(
                this.round.tickets
            ).filter(
                ticket =>
                    String(ticket.playerId) === id
            );

        if (
            playerTickets.length >=
            MAX_TICKETS
        ) {
            throw new Error(
                'Maximum 20 tickets per round'
            );
        }

        const paymentSource =
            await this.deductStake(
                playerRef,
                numericStake
            );

        const ticketId =
            `${this.round.roundNumber}-${Date.now()}-${randomInt(1000000)}`;

        const ticket = {

            id: ticketId,

            playerId: id,

            numbers: cleanNumbers,

            stake: numericStake,

            paymentSource,

            matches: 0,

            payout: 0,

            status: 'active',

            createdAt:
                new Date().toISOString()
        };

        this.round.tickets[ticketId] =
            ticket;

        this.round.playerIds.add(id);

        return ticket;
    }

    async getState(playerId) {

    if (!this.round) {
        return null;
    }

    const id =
        playerId == null
            ? null
            : String(playerId);

    const tickets =
        id
            ? Object.values(
                this.round.tickets
            ).filter(
                ticket =>
                    String(ticket.playerId) === id
            )
            : [];

    let balance = 0;
    let referralBonusBalance = 0;

    if (id && this.db) {
        const snapshot =
            await this.db
                .ref(`players/${id}`)
                .once('value');

        const player =
            snapshot.val() || {};

        balance =
            Number(player.balance || 0);

        referralBonusBalance =
            Number(
                player.referralBonusBalance || 0
            );
    }

    return {

        roundNumber:
            this.round.roundNumber,

        phase:
            this.round.phase,

        seconds:
            this.round.seconds,

        drawnNumbers:
            [...this.round.drawnNumbers],

        playerCount:
            this.round.playerIds.size,

        ticketCount:
            Object.keys(
                this.round.tickets
            ).length,

        tickets,

        stakes:
            [...STAKES],

        maxSelections:
            MAX_SELECTIONS,

        maxTickets:
            MAX_TICKETS,

        maxNumbers:
            MAX_NUMBERS,

        drawCount:
            DRAW_COUNT,

        balance,

        referralBonusBalance
    };
}

}

module.exports = {
    NumbersGameManager,
    PAYOUTS,
    STAKES
};