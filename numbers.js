(function () {
  "use strict";

  /* ================================
     LOCKED GAME SETTINGS
  ================================= */

  const MAX_NUMBERS = 80;
  const MAX_SELECTIONS = 10;
  const MAX_TICKETS = 20;

  const BETTING_TIME = 30;
  const DRAW_TIME = 20;
  const DRAW_COUNT = 20;

  const STAKES = [2, 3, 5, 10, 20, 50];

  const PAYOUTS = {
  1: {
    1: 6
  },

  2: {
    2: 20
  },

  3: {
    3: 90
  },

  4: {
    4: 160,
    3: 20
  },

    5: {
      5: 300,
      4: 30
    },

    6: {
      6: 1000,
      5: 100,
      4: 40
    },

    7: {
      7: 2500,
      6: 250,
      5: 60
    },

    8: {
      8: 5000,
      7: 500,
      6: 100
    },

    9: {
      9: 10000,
      8: 1000,
      7: 200
    },

    10: {
      10: 15000,
      9: 1500,
      8: 300
    }
  };


  /* ================================
     GAME STATE
  ================================= */

  let balance = 0;
  const API_URL = 'https://za-bingo-5a7e.onrender.com';

const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
const playerId = telegramUser?.id ? String(telegramUser.id) : null;

async function loadNumbersState() {
    if (!playerId) {
        console.error("Numbers: Telegram player ID not found");
        return;
    }

    try {
        const response = await fetch(
            `${API_URL}/api/numbers/state?playerId=${encodeURIComponent(playerId)}`
        );

        const data = await response.json();

        if (!data.success || !data.state) {
            console.error("Numbers state error:", data.error);
            return;
        }

        const state = data.state;

        roundNumber = Number(state.roundNumber || roundNumber);

        phase =
            state.phase === "finished"
                ? "results"
                : state.phase;

        seconds = Number(state.seconds || 0);

        drawnNumbers =
            Array.isArray(state.drawnNumbers)
                ? state.drawnNumbers
                : [];

        drawnSet = new Set(drawnNumbers);

        tickets =
            Array.isArray(state.tickets)
                ? state.tickets
                : [];

        balance = Number(state.balance || 0);

        updateBalance();

        $("round-number").textContent =
            "#" + roundNumber;

        updateTimer();
        updateDrawDisplay();
        renderTickets();
        updatePotentialWin();

    } catch (error) {
        console.error(
            "Numbers connection error:",
            error
        );
    }
}

  let roundNumber = 1001;

  let phase = "betting";

  let seconds = BETTING_TIME;

  let selectedNumbers = new Set();

  let drawnNumbers = [];

  let drawnSet = new Set();

  let tickets = [];

  let ticketId = 1;

  let currentStake = 2;

  let timer = null;

  let drawTimer = null;


  /* ================================
     DOM
  ================================= */

  const $ = id =>
    document.getElementById(id);


  /* ================================
     FORMAT
  ================================= */

  function br(value) {
    return (
      Number(value)
        .toLocaleString("en-US") +
      " Br"
    );
  }


  function shuffle(array) {

    const result = [...array];

    for (
      let i = result.length - 1;
      i > 0;
      i--
    ) {

      const j =
        Math.floor(
          Math.random() * (i + 1)
        );

      [
        result[i],
        result[j]
      ] = [
        result[j],
        result[i]
      ];
    }

    return result;
  }


  /* ================================
     BALANCE
  ================================= */

  function updateBalance() {

    $("player-balance").textContent =
      br(balance);
  }


  /* ================================
     PLAYER COUNT
  ================================= */

  function simulatedPlayers() {

    const now = new Date();

    const minute =
      now.getHours() * 60 +
      now.getMinutes();

    let min;
    let max;

    if (
      minute >= 240 &&
      minute < 515
    ) {
      min = 44;
      max = 46;

    } else if (
      minute >= 515 &&
      minute < 560
    ) {
      min = 43;
      max = 46;

    } else if (
      minute >= 560 &&
      minute < 685
    ) {
      min = 47;
      max = 50;

    } else if (
      minute >= 685 &&
      minute < 1000
    ) {
      min = 52;
      max = 55;

    } else if (
      minute >= 1000 &&
      minute < 1425
    ) {
      min = 52;
      max = 55;

    } else if (
      minute >= 1425 ||
      minute < 98
    ) {
      min = 50;
      max = 52;

    } else {
      min = 44;
      max = 46;
    }

    return (
      Math.floor(
        Math.random() *
        (max - min + 1)
      ) + min
    );
  }


  function updatePlayers() {

    $("player-count").textContent =
      simulatedPlayers();
  }


  /* ================================
     NUMBER GRID
  ================================= */

  function createNumberGrid() {

    const grid =
      $("numbers-80-grid");

    grid.innerHTML = "";

    for (
      let number = 1;
      number <= MAX_NUMBERS;
      number++
    ) {

      const button =
        document.createElement("button");

      button.type = "button";

      button.className =
        "number-btn";

      button.textContent =
        number;

      button.dataset.number =
        number;

      button.addEventListener(
        "click",
        () => selectNumber(number)
      );

      grid.appendChild(button);
    }

    updateNumberGrid();
  }


  function updateNumberGrid() {

    document
      .querySelectorAll(".number-btn")
      .forEach(button => {

        const number =
          Number(button.dataset.number);

        button.classList.toggle(
          "selected",
          selectedNumbers.has(number)
        );

        button.classList.toggle(
          "drawn",
          drawnSet.has(number)
        );

        button.disabled =
          phase !== "betting";
      });

    $("selection-count").textContent =
      selectedNumbers.size;
  }


  function selectNumber(number) {

    if (phase !== "betting")
      return;

    if (
      selectedNumbers.has(number)
    ) {

      selectedNumbers.delete(number);

    } else {

      if (
        selectedNumbers.size >=
        MAX_SELECTIONS
      ) {
        showToast(
          "Maximum 10 numbers"
        );
        return;
      }

      selectedNumbers.add(number);
    }

    updateNumberGrid();
    updatePotentialWin();
  }


  function randomSelect(count) {

    if (phase !== "betting")
      return;

    selectedNumbers.clear();

    shuffle(
      Array.from(
        { length: MAX_NUMBERS },
        (_, i) => i + 1
      )
    )
      .slice(0, count)
      .forEach(number =>
        selectedNumbers.add(number)
      );

    updateNumberGrid();
    updatePotentialWin();
  }


  function clearSelection() {

    if (phase !== "betting")
      return;

    selectedNumbers.clear();

    updateNumberGrid();
    updatePotentialWin();
  }


  /* ================================
     STAKES
  ================================= */

  function setStake(stake) {

    if (!STAKES.includes(stake))
      return;

    currentStake = stake;

    document
      .querySelectorAll(".stake-chip")
      .forEach(chip => {

        chip.classList.toggle(
          "active",
          Number(chip.dataset.stake) ===
          currentStake
        );
      });

    $("buy-ticket-cost").textContent =
      br(currentStake);

    updatePotentialWin();
  }


  /* ================================
     PAYOUT
  ================================= */

  function payout(
    numberCount,
    matches,
    stake
  ) {

    const base =
      PAYOUTS[numberCount]?.[matches] ||
      0;

    return base * (stake / 2);
  }


  function updatePotentialWin() {

    const count =
      selectedNumbers.size;

    if (count === 0) {

      $("potential-win-val")
        .textContent = "0 Br";

      return;
    }

    const max =
      payout(
        count,
        count,
        currentStake
      );

    $("potential-win-val")
      .textContent = br(max);
  }


  /* ================================
     BUY TICKET
  ================================= */

  async function buyTicket() {
    if (phase !== "betting") {
        showToast("Betting is closed");
        return;
    }

    if (!playerId) {
        showToast("Telegram user not found");
        return;
    }

    if (selectedNumbers.size < 1) {
        showToast("Select at least 1 number");
        return;
    }

    if (selectedNumbers.size > MAX_SELECTIONS) {
        showToast("Maximum 10 numbers");
        return;
    }

    if (tickets.length >= MAX_TICKETS) {
        showToast("Maximum 20 tickets");
        return;
    }

    const numbers = [...selectedNumbers].sort((a, b) => a - b);

    try {
        const response = await fetch(
            `${API_URL}/api/numbers/ticket`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    playerId: String(playerId),
                    numbers: numbers,
                    stake: Number(currentStake)
                })
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            showToast(
                data.error ||
                data.message ||
                "Ticket purchase failed"
            );
            return;
        }

        selectedNumbers.clear();

        await loadNumbersState();

        updateNumberGrid();
        updatePotentialWin();

        showToast("Ticket purchased");
    } catch (error) {
        console.error("Numbers ticket error:", error);
        showToast("Unable to connect to server");
    }
}


  /* ================================
     TICKETS
  ================================= */

  function renderTickets() {

    const container =
      $("tickets-list-container");

    container.innerHTML = "";

    $("tickets-quota").textContent =
      `${tickets.length} / ${MAX_TICKETS} this round`;


    if (tickets.length === 0) {

      const empty =
        document.createElement("div");

      empty.className =
        "empty-tickets";

      empty.textContent =
        "No tickets yet";

      container.appendChild(empty);

      return;
    }


    tickets.forEach(ticket => {

      const item =
        document.createElement("div");

      item.className =
        "ticket-item";

      if (ticket.status === "won")
        item.classList.add("won");


      const header =
        document.createElement("div");

      header.className =
        "ticket-header";

      header.innerHTML =
        `<span>Ticket #${ticket.id}</span>
         <span>${br(ticket.stake)}</span>`;


      const numbers =
        document.createElement("div");

      numbers.className =
        "ticket-numbers";


      ticket.numbers.forEach(number => {

        const ball =
          document.createElement("span");

        ball.className =
          "ticket-ball";

        ball.textContent =
          number;

        if (
          drawnSet.has(number)
        ) {
          ball.classList.add("match");
        }

        numbers.appendChild(ball);
      });


      const result =
        document.createElement("div");

      const badge =
        document.createElement("span");

      badge.className =
        "ticket-result-badge " +
        ticket.status;


      if (
        ticket.status ===
        "pending"
      ) {

        badge.textContent =
          "Pending";

      } else if (
        ticket.status ===
        "won"
      ) {

        badge.textContent =
          `${ticket.matches} matches • +${br(ticket.payout)}`;

      } else {

        badge.textContent =
          `${ticket.matches} matches`;
      }


      result.appendChild(badge);

      item.appendChild(header);
      item.appendChild(numbers);
      item.appendChild(result);

      container.appendChild(item);
    });
  }


  /* ================================
     DRAW DISPLAY
  ================================= */

  function createDrawSlots() {

    const row =
      $("draw-balls-row");

    row.innerHTML = "";

    for (
      let i = 0;
      i < DRAW_COUNT;
      i++
    ) {

      const slot =
        document.createElement("div");

      slot.className =
        "draw-ball-slot";

      row.appendChild(slot);
    }
  }


  function updateDrawDisplay() {

    const slots =
      document.querySelectorAll(
        ".draw-ball-slot"
      );


    slots.forEach(
      (slot, index) => {

        slot.classList.remove(
          "active"
        );

        if (
          drawnNumbers[index] !==
          undefined
        ) {

          slot.textContent =
            drawnNumbers[index];

          slot.classList.add(
            "active"
          );

        } else {

          slot.textContent = "";
        }
      }
    );


    $("draw-count-badge")
      .innerHTML =
      `Drawn: <span class="active">
        ${drawnNumbers.length}
      </span> / 20`;
  }


  /* ================================
     TIMER DISPLAY
  ================================= */

  function updateTimer() {

    $("timer-seconds")
      .textContent = seconds;

    $("timer-phase")
      .textContent =
      phase === "betting"
        ? "BETTING"
        : phase === "drawing"
          ? "DRAWING"
          : "RESULTS";

    $("timer-phase").className =
      "timer-phase " + phase;

    $("btn-buy-ticket")
      .disabled =
      phase !== "betting";

    updateNumberGrid();
  }


  /* ================================
     BETTING
  ================================= */

let stateTimer = null;

function syncNumbersUI() {
    if (phase === "betting") {
        $("numbers-80-grid").style.display = "";
        $("numbers-80-grid").parentElement.style.display = "";
        $("stake-chips-row").closest(".bet-controls-card").style.display = "";
    } else {
        $("numbers-80-grid").style.display = "none";
        $("numbers-80-grid").parentElement.style.display = "none";
        $("stake-chips-row").closest(".bet-controls-card").style.display = "none";
    }

    updateTimer();
    updateDrawDisplay();
    renderTickets();
}

function startNumbersSync() {
    if (stateTimer) {
        clearInterval(stateTimer);
    }

    loadNumbersState();
    syncNumbersUI();

    stateTimer = setInterval(async () => {
        await loadNumbersState();
        syncNumbersUI();
    }, 1000);
}


        


  /* ================================
     PAYOUT MODAL
  ================================= */

  function openPayoutModal() {

    const modal =
      $("payout-modal");

    const body =
      $("modal-payout-body");

    body.innerHTML = "";


    const table =
      document.createElement("table");

    table.className =
      "payout-preview-table";


    table.innerHTML =
      `<thead>
        <tr>
          <th>Numbers</th>
          <th>Match</th>
          <th>2 Br Reward</th>
        </tr>
      </thead>
      <tbody></tbody>`;


    const tbody =
      table.querySelector("tbody");


    for (
      let count = 3;
      count <= 10;
      count++
    ) {

      const rewards =
        PAYOUTS[count] || {};


      Object.keys(rewards)
        .map(Number)
        .sort((a, b) => b - a)
        .forEach(matches => {

          const row =
            document.createElement("tr");

          row.innerHTML =
            `<td>${count}</td>
             <td>${matches} / ${count}</td>
             <td class="reward">
               ${br(rewards[matches])}
             </td>`;

          tbody.appendChild(row);
        });
    }


    body.appendChild(table);

    modal.classList.add("open");
  }


  function closePayoutModal() {

    $("payout-modal")
      .classList.remove("open");
  }


  /* ================================
     TOAST
  ================================= */

  function showToast(message) {

    const toast =
      $("celebration-toast");

    $("celebration-message")
      .textContent = message;

    toast.classList.add("show");


    setTimeout(
      () =>
        toast.classList.remove(
          "show"
        ),
      2500
    );
  }


  /* ================================
     EVENTS
  ================================= */

  function setupEvents() {

    $("btn-random-5")
      .addEventListener(
        "click",
        () => randomSelect(5)
      );

    $("btn-random-10")
      .addEventListener(
        "click",
        () => randomSelect(10)
      );

    $("btn-clear-selection")
      .addEventListener(
        "click",
        clearSelection
      );

    document
      .querySelectorAll(".stake-chip")
      .forEach(chip => {

        chip.addEventListener(
          "click",
          () =>
            setStake(
              Number(
                chip.dataset.stake
              )
            )
        );
      });

    $("btn-buy-ticket")
      .addEventListener(
        "click",
        buyTicket
      );

    $("btn-open-payouts")
      .addEventListener(
        "click",
        openPayoutModal
      );

    $("btn-close-modal")
      .addEventListener(
        "click",
        closePayoutModal
      );

    $("payout-modal")
      .addEventListener(
        "click",
        event => {

          if (
            event.target ===
            $("payout-modal")
          ) {
            closePayoutModal();
          }
        }
      );


    /* ================================
       BOTTOM NAVIGATION
    ================================= */

    document
      .querySelectorAll(".bottom-nav-btn")
      .forEach(button => {

        button.addEventListener(
          "click",
          function () {

            const page =
              this.dataset.page;


            document
              .querySelectorAll(
                ".bottom-nav-btn"
              )
              .forEach(btn => {

                btn.classList.remove(
                  "active"
                );

              });


            this.classList.add(
              "active"
            );


            $("game-page").style.display =
              "none";

            $("profile-page").style.display =
              "none";

            $("wallet-page").style.display =
              "none";

            $("info-page").style.display =
              "none";

            $("history-page").style.display =
              "none";


            if (page === "game") {

              $("game-page").style.display =
                "grid";

            }

            if (page === "profile") {

              $("profile-page").style.display =
                "block";

            }

            if (page === "wallet") {

              $("wallet-page").style.display =
                "block";

            }

            if (page === "info") {

              $("info-page").style.display =
                "block";

            }

            if (page === "history") {

              $("history-page").style.display =
                "block";

            }

          }
        );

      });

  }


  /* ================================
     START
  ================================= */

  function init() {

    createNumberGrid();

    createDrawSlots();

    setupEvents();

    updateBalance();

    loadNumbersState();

    updatePlayers();

    $("round-number")
      .textContent =
      "#" + roundNumber;

    $("buy-ticket-cost")
      .textContent =
      br(currentStake);

    renderTickets();

    startNumbersSync();

    setInterval(
      updatePlayers,
      10000
    );

  }


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init
    );

  } else {

    init();

  }

})();
