// --- FIREBASE IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, setDoc, addDoc, deleteDoc, updateDoc, getDoc, serverTimestamp, query, arrayUnion, where, orderBy, limit, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- FIREBASE CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyB4PRTEgOamRUd1Hk69dFtPWJn8CayEPJo",
    authDomain: "controle-obras-frinox.firebaseapp.com",
    projectId: "controle-obras-frinox",
    storageBucket: "controle-obras-frinox.firebasestorage.app",
    messagingSenderId: "125104743179",
    appId: "1:125104743179:web:c497fb5e5f92ae9671780e"
};

// --- VARIÁVEIS GLOBAIS ---
let app, auth, db;
let obrasCollection, funcionariosCollection, empresasCollection, settingsCollection, usersCollection, userPreferencesCollection, notificacoesCollection;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'controle-obras-frinox';

let currentUser = null;
let obras = [], funcionarios = [], empresas = [], users = [], obraOrder = [], activeProjectIds = [], notificacoes = [];
let tempPedidos = [];

let ganttExpandedState = {};
let selectedEmpresaId = null;
let currentAlocacaoEtapaId = null;
let currentInfoEtapaId = null;
let currentEtapaGroupContext = {}; // Para navegação no modal de alocação
let currentInfoEtapaGroupContext = {}; // Para navegação no modal de info
let activeAlocacaoSortables = [], activeHotelSortables = [], activeProjectsSortables = [];
let ganttSidebarSortable = null;
let currentTab = 'Gantt';
let colaboradorEtapasMap = new Map();
let conflictMap = new Map();
let obraLabelType = 'numero';
let zoomLevel = 4;
const zoomLevels = [10, 20, 30, 40, 50, 65, 80, 100];
let lastKnownScrollLeft = null;
let ganttDragInfo = { isDragging: false };
let copyModeState = { active: false, sourceEtapaId: null, colaboradoresToCopy: [] };
let unsubscribeNotifications = null;

let preserveSortOrderOnNextRender = false;
let currentObraRenderOrder = []; // Salva a ordem de renderização atual

const PROCEDIMENTOS_LIST = [
    { key: 'emailLiberacao', label: 'Enviar e-mail solicitando liberação' },
    { key: 'cobrarRetorno', label: 'Caso não tenha retorno cobrar' },
    { key: 'prazoLiberacao', label: 'Prazo máximo para liberação' },
    { key: 'reservarHotel', label: 'Reservar hotel' },
    { key: 'pastaViagem', label: 'Pasta de viagem' }
];

let isLoggingEnabled = false;
let systemLogs = [];

const projectColors = [
    ["#60a5fa", "#3b82f6"], ["#4ade80", "#22c55e"], ["#fbbf24", "#f59e0b"],
    ["#f87171", "#ef4444"], ["#818cf8", "#6366f1"], ["#a78bfa", "#8b5cf6"],
    ["#f472b6", "#ec4899"], ["#2dd4bf", "#14b8a6"], ["#fb923c", "#f97316"],
    ["#34d399", "#10b981"], ["#c084fc", "#a855f7"], ["#22d3ee", "#06b6d4"],
    ["#e879f9", "#d946ef"], ["#fde047", "#eab308"], ["#a3e635", "#84cc16"],
    ["#7dd3fc", "#0ea5e9"], ["#fca5a5", "#f87171"], ["#d8b4fe", "#c084fc"],
    ["#6ee7b7", "#34d399"], ["#fdba74", "#fb923c"], ["#5eead4", "#2dd4bf"]
];

// --- SISTEMA DE LOG E NOTIFICAÇÃO ---
const getEtapaLogIdentifier = (pedido, etapaId) => {
    if (!pedido || !etapaId) return 'etapa desconhecida';
    const etapa = (pedido.etapas || []).find(e => e.id === etapaId);
    if (!etapa) return 'etapa desconhecida';

    const group = (pedido.etapas || [])
        .filter(e => e.nome === etapa.nome)
        .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));

    if (group.length > 1) {
        const index = group.findIndex(e => e.id === etapaId);
        return `"${etapa.nome}" (${index + 1} de ${group.length})`;
    }

    return `"${etapa.nome}"`;
};

const createNotification = async (obraId, obraNome, message) => {
    if (!currentUser || !obraId || !message) return;
    try {
        await addDoc(notificacoesCollection, {
            obraId,
            obraNome,
            message,
            user: currentUser.nome,
            timestamp: new Date(),
            readBy: []
        });
    } catch (error) {
        console.error("Erro ao criar notificação:", error);
    }
};

const logInteraction = (action, payload) => {
    if (!isLoggingEnabled) return;
    const logEntry = {
        timestamp: new Date().toISOString(),
        user: currentUser?.nome || 'Sistema',
        action: action,
        payload: payload,
        tab: currentTab,
    };
    systemLogs.push(logEntry);
    console.log(`[LOG] User: ${logEntry.user}, Action: ${action}`, payload);
};
const logActivity = async (obraId, message, createNotificationFlag = true) => {
    if (!obraId || !message || !currentUser) {
        console.error("LOG: Parâmetros faltando para registrar atividade.", { obraId, message, user: currentUser });
        return;
    }
    const obra = obras.find(o => o.id === obraId);
    const obraNome = obra ? obra.nome : 'Projeto desconhecido';

    const logEntry = {
        user: currentUser.nome,
        message: message,
        timestamp: new Date()
    };
    try {
        const obraRef = doc(obrasCollection, obraId);
        await updateDoc(obraRef, {
            activityLog: arrayUnion(logEntry)
        });
        if (createNotificationFlag) {
            await createNotification(obraId, obraNome, `${currentUser.nome} ${message}`);
        }
    } catch (error) {
        console.error("LOG: FALHA ao registrar atividade:", error);
    }
};

const downloadLogs = () => {
    const blob = new Blob([JSON.stringify(systemLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log_controle_obras_${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logInteraction('download_logs', { count: systemLogs.length });
};
const toggleLogging = () => {
    isLoggingEnabled = !isLoggingEnabled;
    const toggleBtn = document.getElementById('toggleLogBtn');
    const downloadBtn = document.getElementById('downloadLogBtn');
    if (isLoggingEnabled) {
        toggleBtn.textContent = 'Desativar Log de Depuração';
        toggleBtn.classList.add('text-green-500');
        downloadBtn.classList.remove('hidden');
        systemLogs = [];
        logInteraction('logging_started', {});
        showToast('Log de depuração ativado.');
    } else {
        toggleBtn.textContent = 'Ativar Log de Depuração';
        toggleBtn.classList.remove('text-green-500');
        downloadBtn.classList.add('hidden');
        logInteraction('logging_stopped', {});
        showToast('Log de depuração desativado.');
    }
};

// --- FUNÇÕES DE UTILIDADE E MODAL ---
const showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast p-4 rounded-lg shadow-lg text-white ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 4500);
};
const getColorForId = (id) => {
    if (!id) return projectColors[0];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash % projectColors.length);
    return projectColors[index];
};
const openModal = (modal) => {
    if (!modal) return;
    logInteraction('open_modal', { modalId: modal.id });
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    setTimeout(() => modal.querySelector('.modal-content').classList.remove('scale-95', 'opacity-0'), 50);
};
const closeModal = (modal, showConfirmation = false, message) => {
    if (!modal) return;
    logInteraction('close_modal', { modalId: modal.id });
    modal.querySelector('.modal-content').classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.add('opacity-0');
        if (showConfirmation) {
            showToast(message || 'Ação cancelada.');
        }
    }, 300);
};
const showConfirmModal = (title, message, onConfirm) => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const confirmOk = document.getElementById('confirmOk');
    const newConfirmOk = confirmOk.cloneNode(true);
    confirmOk.parentNode.replaceChild(newConfirmOk, confirmOk);
    newConfirmOk.addEventListener('click', () => {
        logInteraction('confirm_modal_ok', { title, message });
        onConfirm();
        closeModal(modal);
    });
    document.getElementById('confirmCancel').onclick = () => {
        logInteraction('confirm_modal_cancel', { title, message });
        closeModal(modal, true, 'Ação cancelada.');
    };
    openModal(modal);
};
const switchTab = (tabName) => {
    currentTab = tabName;
    logInteraction('switch_tab', { tabName });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.getElementById(`content${tabName}`).classList.remove('hidden');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    if(tabName === 'Gantt') renderGanttChart();
    if(tabName === 'Colaboradores') renderColaboradorView();
    if(tabName === 'Dashboard') renderDashboard();
    if(tabName === 'Gerenciamento') {
        renderEmpresaList();
        renderFuncionarioList();
        renderGerenciamentoView();
    }
    if(tabName === 'Integracoes') renderIntegracoesView();
};
const addDays = (dateStr, days) => {
    const date = new Date(dateStr + 'T00:00:00'); // Ensure we work with local date part only
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
};
const diffInDays = (d1, d2) => {
    // Treat dates as local dates to avoid timezone issues affecting day count
    const date1 = new Date(d1 + 'T00:00:00');
    const date2 = new Date(d2 + 'T00:00:00');
    // Calculate difference in milliseconds and convert to days
    return Math.round((date2 - date1) / (1000 * 60 * 60 * 24));
};
const getWeekNumber = (d) => {
    const date = new Date(d.valueOf());
    date.setHours(0, 0, 0, 0);
    // Thursday in current week decides the year.
    date.setDate(date.getDate() + 4 - (date.getDay() || 7));
    // Get first day of year
    const yearStart = new Date(date.getFullYear(), 0, 1);
    // Calculate full weeks to nearest Thursday
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}

const scrollToToday = (ganttTimeline, ganttStartDate) => {
    if (!ganttTimeline || !ganttStartDate) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Ignore time part
    const todayOffset = Math.max(0, diffInDays(ganttStartDate.toISOString().split('T')[0], today.toISOString().split('T')[0]));
    const dayWidth = zoomLevels[zoomLevel];
    // Calculate scroll position to place 'today' marker roughly 10% from the left edge
    const scrollPos = (todayOffset * dayWidth) - (ganttTimeline.clientWidth * 0.1);
    // Use setTimeout to ensure the browser has rendered the timeline before scrolling
    setTimeout(() => {
        ganttTimeline.scroll({
            left: Math.max(0, scrollPos), // Ensure scroll position is not negative
            behavior: 'auto' // Use 'auto' for potentially faster scrolling on initial load
        });
    }, 50); // Small delay
};
const updateColaboradorEtapasMap = () => {
    colaboradorEtapasMap.clear();
    obras.forEach((obra) => {
        const color = getColorForId(obra.id)[1]; // Get the secondary color for etapas
        (obra.pedidos || []).forEach(pedido => {
            (pedido.etapas || []).forEach(etapa => {
                if(etapa.data_inicio && etapa.data_fim) { // Only map etapas with valid dates
                    (etapa.colaboradores_alocados || []).forEach(funcId => {
                        if (!colaboradorEtapasMap.has(funcId)) {
                            colaboradorEtapasMap.set(funcId, []);
                        }
                        colaboradorEtapasMap.get(funcId).push({
                            ...etapa,
                            obraNome: obra.nome,
                            obraNumero: obra.numero,
                            pedidoNumero: pedido.numero,
                            color: color // Store color for gantt rendering
                        });
                    });
                }
            });
        });
    });
};
const getObraSortPriority = (obra, today) => {
    let earliestStartDate = null;
    let isActive = false;

    const etapas = (obra.pedidos || []).flatMap(p => p.etapas || []);
    if (etapas.length === 0) {
        // Obra without tasks gets lowest priority, far future date
        return { priority: 3, date: new Date('2999-12-31') };
    }

    for (const etapa of etapas) {
        if (!etapa.data_inicio) continue; // Skip etapas without start date
        const startDate = new Date(etapa.data_inicio + 'T00:00:00');
        const endDate = new Date((etapa.data_fim || etapa.data_inicio) + 'T00:00:00'); // Use start date if end date is missing

        // Check if the task is currently active
        if (startDate <= today && today <= endDate) {
            isActive = true;
            // Update earliest start date if this active task starts earlier
            if (!earliestStartDate || startDate < earliestStartDate) {
                earliestStartDate = startDate;
            }
        } else if (startDate > today) { // Check if the task is in the future
            // Update earliest start date if this future task starts earlier
            if (!earliestStartDate || startDate < earliestStartDate) {
                earliestStartDate = startDate;
            }
        }
        // Past tasks are ignored for determining the 'earliestStartDate' unless they make the project active
    }

    // Determine priority based on status
    if (isActive) return { priority: 1, date: earliestStartDate || today }; // Active projects first
    if (earliestStartDate) return { priority: 2, date: earliestStartDate }; // Future projects second
    return { priority: 3, date: new Date('2999-12-31') }; // Completed or past projects last
};
const getEarliestTaskDateForEmployee = (funcId, today) => {
    const tasks = colaboradorEtapasMap.get(funcId) || [];
    if (tasks.length === 0) return { priority: 3, date: new Date('2999-12-31') }; // Employee with no tasks gets lowest priority

    let earliestStartDate = null;
    let isActive = false;

    for (const task of tasks) {
        const startDate = new Date(task.data_inicio + 'T00:00:00');
        const endDate = new Date(task.data_fim + 'T00:00:00');
        // Check if the employee is currently active in this task
        if (startDate <= today && today <= endDate) {
            isActive = true;
             // Update earliest start date if this active task starts earlier
            if (!earliestStartDate || startDate < earliestStartDate) {
                earliestStartDate = startDate;
            }
        } else if (startDate > today) { // Check if the task is in the future
             // Update earliest start date if this future task starts earlier
            if (!earliestStartDate || startDate < earliestStartDate) {
                earliestStartDate = startDate;
            }
        }
    }

    // Determine priority based on activity status
    if (isActive) return { priority: 1, date: earliestStartDate || today }; // Active employees first
    if (earliestStartDate) return { priority: 2, date: earliestStartDate }; // Employees with future tasks second
    return { priority: 3, date: new Date('2999-12-31') }; // Employees with only past tasks last
};

// --- LÓGICA DE INTEGRAÇÕES (NOVO v10.4) ---
/**
 * Calculates the integration status for a given employee.
 * @param {object} func - The employee object from Firestore.
 * @returns {object} An object containing status for BRF and JBS, each with:
 * - status: 'em_dia', 'vencendo', 'sem_integracao'
 * - dias_restantes: number (or null if not applicable)
 * - data_validade: string (YYYY-MM-DD or null)
 */
const getIntegracaoStatus = (func) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    const checkStatus = (validadeDateStr) => {
        if (!validadeDateStr) {
            return { status: 'sem_integracao', dias_restantes: null, data_validade: null };
        }
        
        const validadeDate = new Date(validadeDateStr + 'T00:00:00');
        
        if (isNaN(validadeDate.getTime())) {
             return { status: 'sem_integracao', dias_restantes: null, data_validade: validadeDateStr };
        }

        const diffDays = diffInDays(today.toISOString().split('T')[0], validadeDateStr);

        // v10.8: Adicionada verificação de VENCIDA
        if (validadeDate < today) {
            return { status: 'vencida', dias_restantes: diffDays, data_validade: validadeDateStr };
        }
        
        if (validadeDate <= thirtyDaysFromNow) {
            return { status: 'vencendo', dias_restantes: diffDays, data_validade: validadeDateStr };
        } else {
            return { status: 'em_dia', dias_restantes: diffDays, data_validade: validadeDateStr };
        }
    };

    return {
        brf: checkStatus(func.integracaoBRF),
        jbs: checkStatus(func.integracaoJBS)
    };
};


// --- LÓGICA DE CONFLITOS ---
const calculateAllConflicts = () => {
    if (funcionarios.length === 0) return;
    conflictMap.clear();
    updateColaboradorEtapasMap(); // Make sure the map is up-to-date

    colaboradorEtapasMap.forEach((etapas, funcId) => {
        // Sort etapas chronologically for the current employee
        const sortedEtapas = [...etapas].sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));

        // Compare each pair of tasks for overlaps
        for (let i = 0; i < sortedEtapas.length; i++) {
            for (let j = i + 1; j < sortedEtapas.length; j++) {
                const e1 = sortedEtapas[i];
                const e2 = sortedEtapas[j];
                // Skip if dates are invalid
                if (!e1.data_inicio || !e1.data_fim || !e2.data_inicio || !e2.data_fim) continue;

                const start1 = new Date(e1.data_inicio);
                const end1 = new Date(e1.data_fim);
                const start2 = new Date(e2.data_inicio);
                const end2 = new Date(e2.data_fim);

                // Check for overlap: (StartA <= EndB) and (StartB <= EndA)
                if (start1 <= end2 && start2 <= end1) {
                    const func = funcionarios.find(f => f.id === funcId);
                    const funcName = func ? func.nome : `ID Desconhecido`;

                    // Create conflict messages
                    const conflictInfo1 = `Conflito de ${funcName} com: ${e2.obraNome} (Pedido ${e2.pedidoNumero}) - Etapa "${e2.nome}"`;
                    const conflictInfo2 = `Conflito de ${funcName} com: ${e1.obraNome} (Pedido ${e1.pedidoNumero}) - Etapa "${e1.nome}"`;

                    // Store conflict info in the map, keyed by etapa ID, then func ID
                    if (!conflictMap.has(e1.id)) conflictMap.set(e1.id, new Map());
                    conflictMap.get(e1.id).set(funcId, conflictInfo1);

                    if (!conflictMap.has(e2.id)) conflictMap.set(e2.id, new Map());
                    conflictMap.get(e2.id).set(funcId, conflictInfo2);
                }
            }
        }
    });
};

// --- LÓGICA DO GANTT ---
const mergeDateRanges = (etapas) => {
    if (!etapas || etapas.length === 0) return [];
    
    // v11.4: Filtrar, mapear para objetos com datas e status, e ordenar
    const sorted = [...etapas]
        .filter(e => e.data_inicio && e.data_fim)
        .map(e => ({ 
            start: new Date(e.data_inicio + 'T00:00:00'), 
            end: new Date(e.data_fim + 'T00:00:00'),
            // v11.4: Rastreia o status da visualização. 'false' (azul) tem prioridade.
            visualizacaoRH: e.visualizacaoRH 
        }))
        .sort((a, b) => a.start - b.start);

    if (sorted.length === 0) return [];

    const merged = [];
    let currentMerge = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
        const nextEtapa = sorted[i];
        
        // Verifica se a próxima tarefa começa no dia seguinte ou antes do término da atual
        if (nextEtapa.start <= new Date(currentMerge.end.getTime() + 86400000)) { // Adiciona um dia em milissegundos
            // Estende a data final se a próxima tarefa terminar depois
            if (nextEtapa.end > currentMerge.end) {
                currentMerge.end = nextEtapa.end;
            }
            // v11.4: Lógica de prioridade da cor
            // Se a barra atual ('currentMerge') for verde (true/undefined) E a próxima for azul (false),
            // a barra inteira se torna azul (false).
            if (currentMerge.visualizacaoRH !== false && nextEtapa.visualizacaoRH === false) {
                currentMerge.visualizacaoRH = false;
            }
        } else {
            // Gap encontrado, finaliza a barra atual e inicia uma nova
            merged.push({
                data_inicio: currentMerge.start.toISOString().split('T')[0],
                data_fim: currentMerge.end.toISOString().split('T')[0],
                visualizacaoRH: currentMerge.visualizacaoRH // v11.4: Salva o status da barra
            });
            currentMerge = { ...nextEtapa };
        }
    }
    
    // Adiciona a última barra mesclada
    merged.push({
        data_inicio: currentMerge.start.toISOString().split('T')[0],
        data_fim: currentMerge.end.toISOString().split('T')[0],
        visualizacaoRH: currentMerge.visualizacaoRH // v11.4: Salva o status da barra
    });
    
    return merged;
};

function drawGanttGrid(containerId, displayRows, isColaboradorView = false) {
    // Destroy existing Sortable instance for sidebar if it exists
    if (ganttSidebarSortable) {
        ganttSidebarSortable.destroy();
        ganttSidebarSortable = null;
    }
    const container = document.getElementById(containerId);
    container.innerHTML = ''; // Clear previous content

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize today to the start of the day
    // Define Gantt chart date range (e.g., current year + next year)
    const ganttStartDate = new Date(today.getFullYear(), 0, 1); // Start of current year
    const ganttEndDate = new Date(today.getFullYear() + 1, 11, 31); // End of next year
    const totalDays = diffInDays(ganttStartDate.toISOString().split('T')[0], ganttEndDate.toISOString().split('T')[0]) + 1;
    const dayWidth = zoomLevels[zoomLevel]; // Get width per day based on zoom level

    // --- Create Header Structure ---
    const headerContainer = document.createElement('div');
    headerContainer.className = 'gantt-header-container';

    // Sidebar header space
    const sidebarHeaderSpace = document.createElement('div');
    sidebarHeaderSpace.className = 'gantt-sidebar-header-space p-2 flex items-end font-semibold';
    sidebarHeaderSpace.innerHTML = isColaboradorView ? 'Colaborador / Empresa' : 'Projetos / Pedidos / Etapas';

    // Timeline header wrapper (for scrolling synchronization)
    const timelineHeaderWrapper = document.createElement('div');
    timelineHeaderWrapper.className = 'gantt-timeline-header-wrapper';

    // Actual timeline header content
    const timelineHeader = document.createElement('div');
    timelineHeader.className = 'gantt-timeline-header';
    timelineHeader.style.width = `${totalDays * dayWidth}px`; // Set total width

    // Containers for different header rows (weeks, months, days, weekdays)
    const weeksHeader = document.createElement('div'); weeksHeader.className = 'flex h-[21px]';
    const monthsHeader = document.createElement('div'); monthsHeader.className = 'flex h-[30px]';
    const daysHeader = document.createElement('div'); daysHeader.className = 'flex h-[30px]';
    const weekdaysHeader = document.createElement('div'); weekdaysHeader.className = 'flex h-[28px]';

    // Calculate month and week spans
    const months = {};
    const weeks = {};
    const startTimestamp = ganttStartDate.getTime();
    const oneDayInMs = 24 * 60 * 60 * 1000;

    for (let i = 0; i < totalDays; i++) {
        const d = new Date(startTimestamp + i * oneDayInMs);
        const year = d.getFullYear();

        // Calculate week number (ISO 8601 week date system)
        const tempDate = new Date(d);
        const dayOfWeek = tempDate.getDay(); // 0 = Sunday, 6 = Saturday
        tempDate.setDate(tempDate.getDate() + 4 - (dayOfWeek || 7)); // Adjust to Thursday of the week
        const weekNum = getWeekNumber(tempDate);
        const weekKey = `${tempDate.getFullYear()}-${weekNum}`; // Unique key for the week

        if (!weeks[weekKey]) weeks[weekKey] = { name: `Semana ${weekNum}`, days: 0 };
        weeks[weekKey].days++; // Count days in this week

        // Calculate month span
        const monthKey = `${year}-${d.getMonth()}`; // Unique key for the month
        if (!months[monthKey]) months[monthKey] = { name: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), days: 0 };
        months[monthKey].days++; // Count days in this month

        // --- Create Day Cell ---
        const dayCell = document.createElement('div');
        dayCell.className = 'flex-shrink-0 text-xs text-center text-gray-400 pt-1 border-r border-gray-700';
        dayCell.style.width = `${dayWidth}px`;
        dayCell.innerText = d.getDate();
        if (d.getTime() === today.getTime()) dayCell.classList.add('bg-blue-900/50'); // Highlight today
        if (d.getDay() === 0) dayCell.classList.add('border-l-2', 'border-cyan-700'); // Highlight Sundays
        daysHeader.appendChild(dayCell);

        // --- Create Weekday Cell ---
        const weekdayCell = document.createElement('div');
        weekdayCell.className = 'flex-shrink-0 text-xs text-center text-gray-500 border-r border-gray-700';
        weekdayCell.style.width = `${dayWidth}px`;
        weekdayCell.innerText = d.toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3); // Abbreviated weekday
        weekdaysHeader.appendChild(weekdayCell);
    }

    // --- Populate Week Header ---
    Object.values(weeks).forEach(week => {
        const weekCell = document.createElement('div');
        weekCell.className = 'flex-shrink-0 text-xs text-center font-semibold text-cyan-300 border-r border-b border-gray-700';
        weekCell.style.width = `${week.days * dayWidth}px`;
        weekCell.innerText = week.name;
        weeksHeader.appendChild(weekCell);
    });

    // --- Populate Month Header ---
    Object.values(months).forEach(month => {
        const monthCell = document.createElement('div');
        monthCell.className = 'flex-shrink-0 text-sm text-center font-semibold text-white p-1 border-r border-b border-gray-700';
        monthCell.style.width = `${month.days * dayWidth}px`;
        monthCell.innerText = month.name.charAt(0).toUpperCase() + month.name.slice(1); // Capitalize month name
        monthsHeader.appendChild(monthCell);
    });

    // Assemble timeline header
    timelineHeader.append(weeksHeader, monthsHeader, daysHeader, weekdaysHeader);
    timelineHeaderWrapper.appendChild(timelineHeader);
    // Assemble full header container
    headerContainer.append(sidebarHeaderSpace, timelineHeaderWrapper);

    // --- Create Body Structure ---
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'gantt-body-container';

    // Sidebar for row labels
    const sidebar = document.createElement('div');
    sidebar.className = 'gantt-sidebar';

    // Timeline area for bars and grid
    const timeline = document.createElement('div');
    timeline.className = 'gantt-timeline';

    // Grid background within the timeline
    const timelineGrid = document.createElement('div');
    timelineGrid.className = 'gantt-timeline-grid';
    timelineGrid.style.width = `${totalDays * dayWidth}px`; // Set total width
    timelineGrid.style.height = `${displayRows.length * 40}px`; // Set total height based on number of rows

    // --- Populate Sidebar Rows and Timeline Bars ---
    displayRows.forEach((item, index) => {
        // --- Sidebar Row ---
        const sidebarRow = document.createElement('div');
        sidebarRow.className = 'gantt-row px-2';
        sidebarRow.dataset.id = item.id;
        sidebarRow.dataset.type = item.type;

        const paddingLeft = (item.level || 0) * 1.5 + 'rem'; // Indentation based on level
        let contentHTML = '';

        // Generate HTML based on item type (obra, pedido, etapa-group, etc.)
        if (item.type === 'obra') {
            const color = getColorForId(item.id)[0];
            const isFinalizada = item.finalizada;
            const hasPendencias = item.hasPendencias;

            // Determine icon based on status
            let iconHTML = '';
            if (isFinalizada) {
                // Checkmark icon for completed projects
                iconHTML = `<svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>`;
            } else if (hasPendencias) {
                // Exclamation mark for projects with pending items
                iconHTML = `<span class="font-bold text-lg text-blue-400">!</span>`;
            } else {
                // Dot icon for active projects without specific flags
                iconHTML = `<div class="w-2.5 h-2.5 bg-blue-500 rounded-full"></div>`;
            }

            contentHTML = `
                <div class="flex items-center w-full" style="padding-left: ${paddingLeft};">
                    <button class="expand-btn action-btn flex-shrink-0 ${ganttExpandedState[item.id] !== false ? 'expanded' : ''}" data-id="${item.id}">
                        <svg class="h-4 w-4 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
                    </button>
                    <div class="flex-grow truncate edit-obra-trigger cursor-pointer ml-2" title="${item.nome}\n${item.subtext}" data-id="${item.id}">
                        <p class="font-bold text-base truncate pointer-events-none" style="color: ${color};">${item.nome}</p>
                        <p class="text-xs truncate pointer-events-none" style="color: ${color}; opacity: 0.8;">${item.subtext}</p>
                    </div>
                    <div class="sidebar-icon-container">
                        <button class="fechamento-btn action-btn" data-id="${item.id}">${iconHTML}</button>
                    </div>
                </div>`;
        } else if (item.type === 'pedido') {
             contentHTML = `<div class="flex items-center gap-2 w-full" style="padding-left: ${paddingLeft}"><button class="expand-btn action-btn ${ganttExpandedState[item.id] !== false ? 'expanded' : ''}" data-id="${item.id}"><svg class="h-4 w-4 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg></button><div class="truncate flex-grow" title="${item.nome}"><p class="font-bold text-sm text-white">${item.nome}</p></div><div class="sidebar-icon-container"></div></div>`;
        } else if (item.type === 'etapa-group') {
            // Check if any etapa in the group has RH pendencies
            const hasAnyPendencia = item.etapas.some(e => !PROCEDIMENTOS_LIST.every(p => e.procedimentos && e.procedimentos[p.key] === 'OK'));
            const iconHTML = hasAnyPendencia
                ? `<span class="text-base text-yellow-400">!</span>` // Exclamation for pendencies
                : `<svg class="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>`; // Checkmark if all OK

            contentHTML = `<div class="flex items-center w-full" style="padding-left: ${paddingLeft};">
                            <p class="font-normal text-xs text-gray-300 truncate flex-grow">${item.nome}</p>
                            <div class="sidebar-icon-container">
                                <button class="rh-pendency-btn action-btn" data-id="${item.id}">${iconHTML}</button>
                            </div>
                           </div>`;
        } else if (item.type === 'empresa_header') {
            // Header row for employee groups in colaborador view
            contentHTML = `<div style="padding-left: ${paddingLeft}"><p class="font-bold text-blue-300 truncate">${item.nome}</p></div>`;
        } else { // Fallback for funcionario row in colaborador view
             contentHTML = `<div style="padding-left: ${paddingLeft}"><p class="font-semibold text-white truncate">${item.nome}</p>${item.subtext ? `<p class="text-xs text-gray-400">${item.subtext}</p>` : ''}</div>`;
        }

        sidebarRow.innerHTML = contentHTML;
        sidebar.appendChild(sidebarRow);

        // --- Determine Tasks to Draw on Timeline for this Row ---
        let tasksToDraw;
        if (isColaboradorView) {
            // In colaborador view, get tasks directly from the map
            tasksToDraw = colaboradorEtapasMap.get(item.id) || [];
        } else if (item.isSummary) {
            // For collapsed obra/pedido rows, draw the summary bars
            tasksToDraw = item.summaryBars;
        } else if (item.type === 'etapa-group') {
            // For expanded etapa groups, draw individual etapa bars
            tasksToDraw = item.etapas;
        } else {
            // Don't draw bars for expanded obra/pedido rows (only their children)
            tasksToDraw = [];
        }

        // --- Draw Task Bars on Timeline Grid ---
        (tasksToDraw || []).forEach(task => {
             if (task.data_inicio && task.data_fim) { // Ensure valid dates
                const startOffset = diffInDays(ganttStartDate.toISOString().split('T')[0], task.data_inicio);
                const duration = diffInDays(task.data_inicio, task.data_fim) + 1; // Duration in days
                if(startOffset < 0 || duration <= 0) return; // Skip invalid date ranges

                const bar = document.createElement('div');
                bar.className = 'gantt-bar';
                bar.style.top = `${(index * 40) + 6}px`; // Position vertically based on row index
                bar.style.left = `${startOffset * dayWidth}px`; // Position horizontally based on start date
                bar.style.width = `${duration * dayWidth}px`; // Set width based on duration

                // Determine bar color (task color in colaborador view, item color otherwise)
                 const barColor = isColaboradorView
                    ? task.color
                    : (task.visualizacaoRH === false ? '#60a5fa' : '#4ade80'); // Blue if not viewed (false), Green if viewed (true) or legacy (undefined)

                bar.style.backgroundColor = barColor;

                bar.dataset.etapaId = task.id; // Store etapa ID for interactions

                // Determine bar label based on context
                let barLabel = '';
                if (isColaboradorView) {
                    barLabel = obraLabelType === 'numero' ? task.obraNumero : task.obraNome;
                } else if (item.type === 'etapa-group') {
                    barLabel = item.nome;
                } else if (item.type === 'pedido' && item.isSummary) {
                    barLabel = item.nome.replace('Pedido: ', '');
                } else if (item.type === 'obra' && item.isSummary) {
                    barLabel = obraLabelType === 'numero' ? item.numero : item.nome;
                }

                let barContent = `<span>${barLabel}</span>`;
                bar.dataset.id = item.id; // Store parent item ID
                bar.dataset.type = item.type; // Store parent item type

                // Add resize handles if it's an individual etapa bar
                const isResizable = item.type === 'etapa-group' && !item.isSummary;
                if (isResizable) {
                    bar.classList.add('resizable');
                    barContent += `<div class="gantt-bar-handle gantt-bar-handle-left"></div><div class="gantt-bar-handle gantt-bar-handle-right"></div>`;
                }

                // Apply copy mode styles if active
                if (copyModeState.active) {
                    if (task.id === copyModeState.sourceEtapaId) {
                        bar.classList.add('copy-source'); // Dim the source bar
                    } else if (item.type === 'etapa-group' && !item.isSummary) {
                        bar.classList.add('copy-targetable'); // Mark potential target bars
                        bar.dataset.targetEtapaId = task.id; // Store target ID
                    }
                }

                // --- Tooltip Information ---
                let tooltipText = `${item.nome}\nInício: ${task.data_inicio}\nFim: ${task.data_fim}`;
                let uniqueColaboradores = new Set(task.colaboradores_alocados || []);
                tooltipText += `\nColaboradores: ${uniqueColaboradores.size}`;

                // --- Conflict Indication ---
                let hasConflictInSummary = false;
                // Check if a summary bar overlaps with any conflicted etapa within it
                if (item.isSummary && (item.conflictedEtapas || []).length > 0) {
                    const summaryStart = new Date(task.data_inicio + 'T00:00:00');
                    const summaryEnd = new Date(task.data_fim + 'T00:00:00');
                    hasConflictInSummary = item.conflictedEtapas.some(conflictedEtapa => {
                        const etapaStart = new Date(conflictedEtapa.data_inicio + 'T00:00:00');
                        const etapaEnd = new Date(conflictedEtapa.data_fim + 'T00:00:00');
                        return etapaStart <= summaryEnd && etapaEnd >= summaryStart; // Overlap check
                    });
                }

                // Apply conflict styling if necessary
                if (conflictMap.has(task.id) || hasConflictInSummary) {
                    bar.classList.add('conflict-flash'); // Add flashing animation
                    barContent += `<span class="absolute right-1 text-white font-bold text-lg leading-none">!</span>`; // Add exclamation mark
                    // Add conflict details to tooltip
                    if (conflictMap.has(task.id)) {
                        tooltipText += `\n\n--- CONFLITOS ---`;
                        conflictMap.get(task.id).forEach((conflictMsg) => {
                            tooltipText += `\n- ${conflictMsg}`;
                        });
                    }
                }
                bar.innerHTML = barContent;
                bar.title = tooltipText; // Set tooltip text
                timelineGrid.appendChild(bar); // Add the bar to the grid
            }
        });
    });

    // --- Today Marker ---
    const todayOffset = diffInDays(ganttStartDate.toISOString().split('T')[0], today.toISOString().split('T')[0]);
    if (todayOffset >= 0) { // Only draw if today is within the Gantt range
        const todayMarker = document.createElement('div');
        todayMarker.id = isColaboradorView ? 'colaboradorTodayMarker' : 'ganttTodayMarker'; // Unique IDs for each view
        todayMarker.style.left = `${(todayOffset * dayWidth) + (dayWidth/2)}px`; // Position in the middle of the day column
        timelineGrid.appendChild(todayMarker);
    }

    // Assemble body container
    timeline.appendChild(timelineGrid);
    bodyContainer.append(sidebar, timeline);
    // Append header and body to the main container
    container.append(headerContainer, bodyContainer);

    // --- Event Listener for Scroll Sync ---
    timeline.addEventListener('scroll', () => {
        // Move the timeline header horizontally to match the timeline scroll position
        timelineHeader.style.transform = `translateX(-${timeline.scrollLeft}px)`;
        // v11.1: Salva a posição do scroll para restauração
        lastKnownScrollLeft = timeline.scrollLeft; 
    });

    // --- Scroll to Today ---
    // v11.1: Só rola para hoje se não tivermos uma posição salva para restaurar
    if (lastKnownScrollLeft === null) {
        scrollToToday(timeline, ganttStartDate);
    }

    // --- Initialize SortableJS for Sidebar (if not in colaborador view) ---
    if (!isColaboradorView) {
        ganttSidebarSortable = new Sortable(sidebar, {
            animation: 150,
            filter: '.gantt-row[data-type="pedido"], .gantt-row[data-type="etapa-group"]', // Apenas [data-type="obra"] pode ser arrastado
            preventOnFilter: true, // Required for filter to work correctly
            onEnd: async (evt) => {
                // Get the new order of obra IDs from the sidebar rows
                const newOrder = Array.from(evt.target.children)
                    .filter(row => row.dataset.type === 'obra') // Only consider obra rows
                    .map(row => row.dataset.id);

                // Check if the order actually changed
                if(newOrder.length !== obraOrder.length || newOrder.some((id, i) => id !== obraOrder[i])){
                    obraOrder = newOrder; // Update global order variable
                    
                    // v11.1: Salva a nova ordem e a preferência 'manual'
                    await setDoc(doc(settingsCollection, 'obraOrder'), { order: newOrder });
                    document.getElementById('obraSort').value = 'manual'; // Set dropdown to manual sorting
                    await saveUserPreferences(); // Salva a preferência 'manual'
                    
                    // v11.1: "Descongela" a lista para aplicar a nova ordem manual
                    preserveSortOrderOnNextRender = false; 
                    
                    lastKnownScrollLeft = timeline.scrollLeft; // Preserve scroll position
                    renderGanttChart(null, lastKnownScrollLeft); // Re-render Gantt com a nova ordem manual
                }
            },
        });
    }
}

const renderGanttChart = (obrasToRender = null, currentScrollLeft = null) => {
    // v11.2: Lógica de scroll ajustada para "proteger" o estado nulo inicial.
    // Isso garante que o scrollToToday() execute corretamente no carregamento,
    // mesmo se o onSnapshot dos funcionários disparar um re-render.
    const timeline = document.querySelector('#ganttChartContainer .gantt-timeline');
    if (currentScrollLeft !== null) { // Se uma posição foi passada (ex: zoom)
        lastKnownScrollLeft = currentScrollLeft;
    } else if (timeline && timeline.scrollLeft > 0) { // Se o usuário já rolou manualmente
        lastKnownScrollLeft = timeline.scrollLeft;
    }
    // Se currentScrollLeft é null E (timeline não existe OU timeline.scrollLeft é 0),
    // lastKnownScrollLeft mantém seu valor anterior (que no início é 'null').

    let sortedObras;

    // v11.1: Verifica se a ordem deve ser "congelada"
    if (preserveSortOrderOnNextRender && currentObraRenderOrder.length > 0) {
        // Usa a ordem exata que estava na tela
        const obrasMap = new Map(obras.map(o => [o.id, o]));
        let ordered = currentObraRenderOrder.map(id => obrasMap.get(id)).filter(Boolean);
        let unordered = obras.filter(o => !currentObraRenderOrder.includes(o.id)); // Adiciona novas obras ao final
        sortedObras = [...ordered, ...unordered].filter(o => activeProjectIds.includes(o.id)); // Filtra pelas ativas

        // Se uma obra "ativa" foi filtrada por busca e não está no render, readiciona
        const activeObrasMap = new Map(sortedObras.map(o => [o.id, o]));
        const missingActive = activeProjectIds.filter(id => !activeObrasMap.has(id));
        missingActive.forEach(id => {
            const obra = obras.find(o => o.id === id);
            if(obra) sortedObras.push(obra);
        });

    } else if (obrasToRender) {
        sortedObras = [...obrasToRender]; // Usa a lista de busca
    } else {
        // v11.1: Executa a lógica de ordenação normal (dropdown ou manual)
        sortedObras = obras.filter(o => activeProjectIds.includes(o.id));
        const sortType = document.getElementById('obraSort').value;
        const today = new Date();
        today.setHours(0,0,0,0);

        if (sortType === 'manual' && obraOrder.length > 0) {
            const obrasMap = new Map(sortedObras.map(o => [o.id, o]));
            let ordered = obraOrder.map(id => obrasMap.get(id)).filter(Boolean);
            let unordered = sortedObras.filter(o => !obraOrder.includes(o.id));
            sortedObras = [...ordered, ...unordered];
        } else if (sortType === 'numero') {
            sortedObras.sort((a, b) => (a.numero || '').localeCompare(b.numero || '', undefined, {numeric: true}));
        } else if (sortType === 'criacao') {
            sortedObras.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
        } else if (sortType === 'pendencias_projeto') {
             sortedObras.sort((a, b) => {
                const aHasPendencia = (a.pendencias || []).some(p => !p.concluida);
                const bHasPendencia = (b.pendencias || []).some(p => !p.concluida);
                if (aHasPendencia && !bHasPendencia) return -1;
                if (!aHasPendencia && bHasPendencia) return 1;
                return 0;
            });
        } else if (sortType === 'pendencias_rh') {
             sortedObras.sort((a, b) => {
                const aHasPendencia = (a.pedidos || []).flatMap(p => p.etapas || []).some(e => !(PROCEDIMENTOS_LIST.every(proc => e.procedimentos && e.procedimentos[proc.key] === 'OK')));
                const bHasPendencia = (b.pedidos || []).flatMap(p => p.etapas || []).some(e => !(PROCEDIMENTOS_LIST.every(proc => e.procedimentos && e.procedimentos[proc.key] === 'OK')));
                if (aHasPendencia && !bHasPendencia) return -1;
                if (!aHasPendencia && bHasPendencia) return 1;
                return 0;
             });
        } else { // 'proximas' (default)
            sortedObras.sort((a, b) => {
                const priorityA = getObraSortPriority(a, today);
                const priorityB = getObraSortPriority(b, today);
                if (priorityA.priority !== priorityB.priority) {
                    return priorityA.priority - priorityB.priority;
                }
                return priorityA.date - priorityB.date;
            });
        }
    }

    // --- Build Display Rows ---
    const displayRows = [];
    sortedObras.forEach((obra) => {
        const colorPair = getColorForId(obra.id);
        const isObraExpanded = ganttExpandedState[obra.id] !== false; // Default to expanded
        const allEtapas = (obra.pedidos || []).flatMap(p => (p.etapas || [])).filter(e => e.data_inicio && e.data_fim);
        const obraSummaryBars = mergeDateRanges(allEtapas);
        const hasPendencias = (obra.pendencias || []).some(p => !p.concluida);
        const obraConflictedEtapas = allEtapas.filter(e => conflictMap.has(e.id));

        displayRows.push({
            ...obra,
            id: obra.id, type: 'obra', level: 0,
            nome: `${obra.nome}`, subtext: `Projeto ${obra.numero}`,
            isSummary: !isObraExpanded,
            // v11.4: REMOVIDO O .map() para preservar o status de visualizacaoRH calculado pelo mergeDateRanges
            summaryBars: obraSummaryBars, 
            hasPendencias: hasPendencias,
            color: colorPair[0],
            conflictedEtapas: obraConflictedEtapas
        });
        if (isObraExpanded) {
            (obra.pedidos || []).sort((a,b) => (a.numero || '').localeCompare(b.numero || '', undefined, {numeric: true})).forEach(pedido => {
                const isPedidoExpanded = ganttExpandedState[pedido.id] !== false;
                const pedidoEtapas = (pedido.etapas || []).filter(e => e.data_inicio && e.data_fim);
                const pedidoSummaryBars = mergeDateRanges(pedidoEtapas);
                const pedidoConflictedEtapas = pedidoEtapas.filter(e => conflictMap.has(e.id));
                displayRows.push({
                    id: pedido.id, type: 'pedido', level: 1,
                    nome: `Pedido: ${pedido.numero}`,
                    isSummary: !isPedidoExpanded,
                    // v11.4: REMOVIDO O .map() para preservar o status de visualizacaoRH
                    summaryBars: pedidoSummaryBars, 
                    color: colorPair[1],
                    conflictedEtapas: pedidoConflictedEtapas
                });
                if(isPedidoExpanded) {
                    const etapasGroupedByName = (pedido.etapas || []).reduce((acc, etapa) => {
                        if (!etapa.nome) return acc;
                        if (!acc[etapa.nome]) acc[etapa.nome] = [];
                        acc[etapa.nome].push(etapa);
                        return acc;
                    }, {});

                    Object.values(etapasGroupedByName).forEach(group => {
                        group.sort((a,b) => new Date(a.data_inicio) - new Date(b.data_inicio));
                        const firstEtapa = group[0];
                        displayRows.push({
                            id: firstEtapa.id,
                            type: 'etapa-group',
                            level: 2,
                            nome: firstEtapa.nome,
                            etapas: group,
                            isSummary: false,
                            color: colorPair[1],
                            pedidoId: pedido.id
                        });
                    });
                }
            });
        }
    });

    // v11.1: Salva a ordem de renderização atual ANTES de desenhar
    // Isso é usado pela flag 'preserveSortOrderOnNextRender'
    currentObraRenderOrder = sortedObras.map(o => o.id);

    // --- Draw the Grid ---
    drawGanttGrid('ganttChartContainer', displayRows, false); // false = not colaborador view
    
    // --- Restore Scroll Position ---
    // v11.2: Lógica de restauração ajustada
    const newTimeline = document.querySelector('#ganttChartContainer .gantt-timeline');
    if(newTimeline) {
        if(lastKnownScrollLeft !== null) {
            // Se temos uma posição salva (zoom, ou rolagem manual prévia), restaura ela
            setTimeout(() => {
                newTimeline.scrollLeft = lastKnownScrollLeft;
            }, 0);
        }
        // Se lastKnownScrollLeft for 'null', a função drawGanttGrid chamará o scrollToToday()
    }
};

const renderColaboradorView = (currentScrollLeft = null) => {
    // Preserve scroll position
    if (typeof currentScrollLeft !== 'number' && currentScrollLeft !== null) currentScrollLeft = null;
    const timeline = document.querySelector('#colaboradorGanttContainer .gantt-timeline');
    lastKnownScrollLeft = currentScrollLeft ?? timeline?.scrollLeft ?? lastKnownScrollLeft ?? null;

    let displayRows = [];
    const sortType = document.getElementById('colaboradorSort').value;
    let sortedFuncionarios = [...funcionarios];

    const today = new Date();
    today.setHours(0,0,0,0);

    // --- Apply Sorting ---
    if (sortType === 'proximas') {
        // Sort by task proximity and activity (active -> future -> past)
        sortedFuncionarios.sort((a, b) => {
            const priorityA = getEarliestTaskDateForEmployee(a.id, today);
            const priorityB = getEarliestTaskDateForEmployee(b.id, today);
            if (priorityA.priority !== priorityB.priority) return priorityA.priority - priorityB.priority; // Sort by priority
            if (priorityA.date.getTime() !== priorityB.date.getTime()) return priorityA.date - priorityB.date; // Then by date
            return a.nome.localeCompare(b.nome); // Finally by name for ties
        });
        // Map sorted employees to display row format
        displayRows = sortedFuncionarios.map(func => ({ ...func, type: 'funcionario', level: 0, subtext: func.cargo }));
    } else if (sortType === 'empresa') {
        // Sort alphabetically first
        sortedFuncionarios.sort((a, b) => a.nome.localeCompare(b.nome));
        // Group employees by empresa_id
        const grouped = sortedFuncionarios.reduce((acc, func) => {
            const empresaId = func.empresa_id || 'sem_empresa'; // Group employees without company
            if (!acc[empresaId]) acc[empresaId] = [];
            acc[empresaId].push(func);
            return acc;
        }, {});
        // Sort empresa groups alphabetically (FRINOX first - handled later in drawGanttGrid specific logic if needed, simple sort here)
        const sortedEmpresaIds = Object.keys(grouped).sort((a, b) => {
            // Prioritize FRINOX EQUIPAMENTOS INDUSTRIAIS
            const empresaA = empresas.find(e => e.id === a);
            const empresaB = empresas.find(e => e.id === b);
            const nomeA = empresaA ? empresaA.nome : 'Sem Empresa';
            const nomeB = empresaB ? empresaB.nome : 'Sem Empresa';

            // --- MODIFICAÇÃO (Hard-coded) ---
            if (nomeA === 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeB !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return -1;
            if (nomeA !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeB === 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return 1;
            // --- FIM DA MODIFICAÇÃO ---

            return nomeA.localeCompare(nomeB); // Alphabetical otherwise
        });
        // Build display rows with headers for each company
        sortedEmpresaIds.forEach(empresaId => {
            const empresa = empresas.find(e => e.id === empresaId);
            displayRows.push({ id: `header_${empresaId}`, type: 'empresa_header', level: 0, nome: empresa ? empresa.nome : 'Sem Empresa' });
            // Add employee rows under their company header
            grouped[empresaId].forEach(func => {
                displayRows.push({ ...func, type: 'funcionario', level: 1, subtext: func.cargo }); // Indent level 1
            });
        });
    } else { // 'alfabetica'
        // Simple alphabetical sort by employee name
        sortedFuncionarios.sort((a, b) => a.nome.localeCompare(b.nome));
        // Map employees to display row format
        displayRows = sortedFuncionarios.map(func => ({ ...func, type: 'funcionario', level: 0, subtext: func.cargo }));
    }

    updateColaboradorEtapasMap(); // Ensure the map used by drawGanttGrid is current
    // --- Draw the Grid ---
    drawGanttGrid('colaboradorGanttContainer', displayRows, true); // true = is colaborador view

    // --- Restore Scroll Position ---
    if(lastKnownScrollLeft !== null) {
        const newTimeline = document.querySelector('#colaboradorGanttContainer .gantt-timeline');
        if(newTimeline) {
            setTimeout(() => {
                newTimeline.scrollLeft = lastKnownScrollLeft;
            }, 0);
        }
    }
};
// --- LÓGICA DO DASHBOARD ---
const renderDashboard = () => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(today.getDate() + 7);

    // Card: Obras em Andamento
    const obrasEmAndamento = obras.filter(obra => {
        if (obra.finalizada) return false; // Exclude finished projects
        // Check if any etapa is currently active
        return (obra.pedidos || []).some(p => (p.etapas || []).some(e => {
            if (!e.data_inicio || !e.data_fim) return false;
            const start = new Date(e.data_inicio + 'T00:00:00');
            const end = new Date(e.data_fim + 'T00:00:00');
            return start <= today && today <= end;
        }));
    }).length;
    document.getElementById('dbObrasAndamento').textContent = obrasEmAndamento;

    // Card: Colaboradores em Conflito
    const conflictedFuncIds = new Set();
    conflictMap.forEach(etapaConflicts => { // Iterate through conflicted etapas
        etapaConflicts.forEach((msg, funcId) => { // Iterate through conflicted employees in each etapa
            conflictedFuncIds.add(funcId);
        });
    });
    document.getElementById('dbColaboradoresConflito').textContent = conflictedFuncIds.size;

    // Card: Pendências de RH
    const totalPendenciasRh = obras.reduce((count, obra) => {
        // Count etapas where not all required procedures are marked 'OK'
        return count + (obra.pedidos || []).flatMap(p => p.etapas || []).filter(e =>
            !PROCEDIMENTOS_LIST.every(proc => e.procedimentos && e.procedimentos[proc.key] === 'OK')
        ).length;
    }, 0);
    document.getElementById('dbPendenciasRh').textContent = totalPendenciasRh;

    // Card: Pendências de Projeto
    const totalPendenciasProjeto = obras.reduce((count, obra) => {
        // Count project-level pendencies that are not marked as completed
        return count + (obra.pendencias || []).filter(p => !p.concluida).length;
    }, 0);
    document.getElementById('dbPendenciasProjeto').textContent = totalPendenciasProjeto;

    // Lista: Etapas Críticas (Próximos 7 dias)
    const proximasEtapasContainer = document.getElementById('dbProximasEtapas');
    const proximasEtapas = [];
    obras.forEach(obra => {
        if (obra.finalizada) return; // Skip finished projects
        (obra.pedidos || []).forEach(pedido => {
            (pedido.etapas || []).forEach(etapa => {
                if (!etapa.data_inicio) return;
                const startDate = new Date(etapa.data_inicio + 'T00:00:00');
                // Check if etapa starts within the next 7 days (including today)
                if (startDate >= today && startDate <= sevenDaysFromNow) {
                    proximasEtapas.push({ ...etapa, obraNome: obra.nome, obraId: obra.id, pedidoNumero: pedido.numero });
                }
            });
        });
    });
    // Sort upcoming etapas by start date
    proximasEtapas.sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
    // Render the list or a placeholder message
    if (proximasEtapas.length > 0) {
        proximasEtapasContainer.innerHTML = proximasEtapas.map(etapa => `
            <div class="bg-gray-700/50 p-3 rounded-lg">
                <p class="font-semibold text-white">${etapa.nome}</p>
                <p class="text-sm text-gray-400">${etapa.obraNome} - Pedido ${etapa.pedidoNumero}</p>
                <p class="text-sm font-bold text-yellow-400">Início em: ${new Date(etapa.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
            </div>
        `).join('');
    } else {
        proximasEtapasContainer.innerHTML = '<p class="text-gray-500">Nenhuma etapa crítica encontrada.</p>';
    }

    // Lista: Atividades Recentes
    const atividadesRecentesContainer = document.getElementById('dbAtividadesRecentes');
    // Flatten all activity logs from all obras, adding obra context
    const allLogs = obras.flatMap(obra =>
        (obra.activityLog || []).map(log => ({...log, obraNome: obra.nome, obraId: obra.id }))
    ).filter(log => log && log.timestamp); // Ensure log and timestamp exist

    // Sort logs by timestamp (most recent first)
    allLogs.sort((a, b) => {
        // Handle both Firestore Timestamp objects and JS Date objects (from newly added logs)
        const dateA = a.timestamp.toDate ? a.timestamp.toDate() : (a.timestamp instanceof Date ? a.timestamp : new Date(0));
        const dateB = b.timestamp.toDate ? b.timestamp.toDate() : (b.timestamp instanceof Date ? b.timestamp : new Date(0));
        return dateB - dateA;
    });
    // Take the top 15 most recent logs
    const recentLogs = allLogs.slice(0, 15);

    // Render the logs or a placeholder message
    if (recentLogs.length > 0) {
        atividadesRecentesContainer.innerHTML = recentLogs.map(log => {
             const date = log.timestamp.toDate ? log.timestamp.toDate() : (log.timestamp instanceof Date ? log.timestamp : null);
            if (!date || !date.getTime) { // Skip if date is invalid
                return '';
            }
            // Calculate time ago string
            const timeAgo = Math.round((new Date() - date) / (1000 * 60)); // minutes ago
            const timeAgoStr = timeAgo < 1 ? 'agora mesmo' : (timeAgo < 60 ? `${timeAgo} min atrás` : `${Math.floor(timeAgo/60)}h atrás`);
            return `
                <div class="border-l-4 border-gray-600 pl-3">
                    <p class="text-sm text-white"><strong class="font-semibold">${log.user}</strong> ${log.message}</p>
                    <p class="text-xs text-gray-400">${log.obraNome} - <span class="text-gray-500">${timeAgoStr}</span></p>
                </div>
            `;
        }).join('');
    } else {
        atividadesRecentesContainer.innerHTML = '<p class="text-gray-500">Nenhuma atividade recente.</p>';
    }
};

const renderEmpresaList = () => {
    const container = document.getElementById('empresaList');
    container.innerHTML = '';
    // Sort empresas, ensuring "FRINOX EQUIPAMENTOS INDUSTRIAIS" is always first
    const sortedEmpresas = [...empresas].sort((a, b) => {
        // --- MODIFICAÇÃO (Hard-coded) ---
        if (a.nome === 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && b.nome !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return -1;
        if (a.nome !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && b.nome === 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return 1;
        // --- FIM DA MODIFICAÇÃO ---
        return a.nome.localeCompare(b.nome); // Alphabetical otherwise
    });
    // Render each empresa item
    sortedEmpresas.forEach(empresa => {
        const selectedClass = empresa.id === selectedEmpresaId ? 'selected' : 'bg-gray-900/50 hover:bg-gray-700/50';
        const el = document.createElement('div');
        el.className = `empresa-item p-3 rounded-lg flex justify-between items-center cursor-pointer transition ${selectedClass}`;
        el.dataset.id = empresa.id;
        el.innerHTML = `<p class="font-semibold text-white pointer-events-none">${empresa.nome}</p>
            <div class="flex items-center gap-2">
                <button data-id="${empresa.id}" class="edit-btn action-btn" title="Editar"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg></button>
                <button data-id="${empresa.id}" class="delete-btn action-btn" title="Excluir"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd" /></svg></button>
            </div>`;
        container.appendChild(el);
    });
};
const renderFuncionarioList = () => {
    const container = document.getElementById('funcionarioList');
    container.innerHTML = '';
    const addBtn = document.getElementById('addFuncionarioBtn');
    const title = document.getElementById('funcionariosTitle');
    
    // Se não há empresa selecionada, exibe placeholder e desativa botão de adicionar
    if (!selectedEmpresaId) {
        container.innerHTML = '<p class="text-sm text-gray-500">Selecione uma empresa para ver os funcionários.</p>';
        addBtn.disabled = true;
        title.textContent = 'Funcionários';
        return;
    }
    const empresa = empresas.find(e => e.id === selectedEmpresaId);
    addBtn.disabled = false;
    title.textContent = `Funcionários de ${empresa.nome}`;
    
    // Filtra funcionários da empresa selecionada
    const funcs = funcionarios.filter(f => f.empresa_id === selectedEmpresaId);
    if (funcs.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">Nenhum funcionário cadastrado.</p>'; return;
    }

    // v10.9 - Funções auxiliares para data e cor (corrigido)
    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        const parts = dateStr.split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return dateStr;
    };

    const getColorClass = (status) => {
        if (status === 'em_dia') return 'data-verde';
        if (status === 'vencendo') return 'data-amarela';
        if (status === 'vencida') return 'data-vermelha';
        return 'data-cinza'; // N/A ou Sem integração
    };

    // Ordena e renderiza a lista
    funcs.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(func => {
        const el = document.createElement('div');
        // v10.9: O card em si é flex (para alinhar botões à direita)
        el.className = 'p-3 bg-gray-900/50 rounded-lg flex justify-between items-center';
        el.dataset.id = func.id;

        // v10.9: Pega status e formata datas/cores
        const intStatus = getIntegracaoStatus(func);
        const brfColorClass = getColorClass(intStatus.brf.status);
        const jbsColorClass = getColorClass(intStatus.jbs.status);
        const brfDate = formatDate(intStatus.brf.data_validade);
        const jbsDate = formatDate(intStatus.jbs.data_validade);
        
        // v10.9 (CORRIGIDO): Layout (Nome - Cargo) na Linha 1, Datas (coloridas) na Linha 2
        el.innerHTML = `
            <div class="flex-grow truncate mr-4">
                <p class="text-sm font-semibold text-white truncate" title="${func.nome} ${func.cargo ? `- ${func.cargo}` : ''}">
                    ${func.nome}
                    <span class="text-gray-400 font-normal">${func.cargo ? `- ${func.cargo}` : ''}</span>
                </p>
                <div class="text-xs mt-1 space-x-4">
                    <span class="${brfColorClass}" title="BRF: ${brfDate}">BRF: ${brfDate}</span>
                    <span class="${jbsColorClass}" title="JBS: ${jbsDate}">JBS: ${jbsDate}</span>
                </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
                <button data-id="${func.id}" class="edit-btn action-btn" title="Editar"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg></button>
                <button data-id="${func.id}" class="delete-btn action-btn" title="Excluir"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd" /></svg></button>
            </div>`;
        container.appendChild(el);
    });
};


const renderGerenciamentoView = () => {
    const activeContainer = document.getElementById('activeProjectsList');
    const archivedContainer = document.getElementById('archivedProjectsList');
    activeContainer.innerHTML = '';
    archivedContainer.innerHTML = '';

    // Populate active and archived lists based on `activeProjectIds`
    obras.forEach(obra => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.dataset.id = obra.id;
        card.innerHTML = `<p class="font-semibold text-sm">${obra.nome}</p><p class="text-xs text-gray-400">Nº: ${obra.numero}</p>`;

        if(activeProjectIds.includes(obra.id)) {
            activeContainer.appendChild(card);
        } else {
            archivedContainer.appendChild(card);
        }
    });

    // Function to save the updated list of active projects
    const onUpdateProjects = async () => {
        const newActiveIds = Array.from(activeContainer.children).map(child => child.dataset.id);
        activeProjectIds = newActiveIds; // Update global variable
        // Save the new list to Firestore
        await setDoc(doc(settingsCollection, 'activeProjects'), { ids: newActiveIds });
        showToast("Lista de projetos ativos atualizada.");
        logInteraction('update_active_projects', { count: newActiveIds.length });
        // Optional: Re-render Gantt if the user might be viewing it
        // if (currentTab === 'Gantt') renderGanttChart();
    };

    // Destroy existing Sortable instances
    activeProjectsSortables.forEach(s => s.destroy());
    activeProjectsSortables = [];
    // Initialize SortableJS for both lists, allowing dragging between them
    activeProjectsSortables.push(new Sortable(activeContainer, { group: 'projects', animation: 150, onEnd: onUpdateProjects }));
    activeProjectsSortables.push(new Sortable(archivedContainer, { group: 'projects', animation: 150, onEnd: onUpdateProjects }));
};

// --- LÓGICA DA ABA INTEGRAÇÕES (NOVO v10.4) ---
const renderIntegracoesView = () => {
    const container = document.getElementById('integracoesListContainer');
    container.innerHTML = ''; // Clear previous content
    container.classList.remove('space-y-1.5'); // v10.9: Remove spacing from container (added to lists)

    // v11.4: Lê os novos filtros
    const filtroStatus = document.getElementById('integracaoFiltroStatus').value;
    const filtroBRF = document.getElementById('integracaoFiltroBRF').checked;
    const filtroJBS = document.getElementById('integracaoFiltroJBS').checked;
    const sortType = document.getElementById('integracaoSort').value;

    let filteredFuncionarios = [...funcionarios];

    // v11.4: Aplicar filtro de STATUS (Tarefa 1)
    if (filtroStatus !== 'todos') {
        filteredFuncionarios = filteredFuncionarios.filter(func => {
            const status = getIntegracaoStatus(func);
            const brfStatus = status.brf.status;
            const jbsStatus = status.jbs.status;

            // Lógica para checar se o funcionário bate com o filtro
            if (filtroStatus === 'em_dia') {
                return brfStatus === 'em_dia' || jbsStatus === 'em_dia';
            }
            if (filtroStatus === 'vencendo') {
                // Deve estar vencendo E não pode estar vencido (vencido tem prioridade)
                const vencendo = brfStatus === 'vencendo' || jbsStatus === 'vencendo';
                const vencido = brfStatus === 'vencida' || jbsStatus === 'vencida';
                return vencendo && !vencido;
            }
            if (filtroStatus === 'vencida') {
                return brfStatus === 'vencida' || jbsStatus === 'vencida';
            }
            if (filtroStatus === 'sem_integracao') {
                return brfStatus === 'sem_integracao' && jbsStatus === 'sem_integracao';
            }
            return true; // Nunca deve cair aqui se filtroStatus !== 'todos'
        });
    }

    // Apply integration filters (BRF/JBS)
    if (filtroBRF || filtroJBS) {
        filteredFuncionarios = filteredFuncionarios.filter(func => {
            const status = getIntegracaoStatus(func);
            const hasBRF = status.brf.status !== 'sem_integracao';
            const hasJBS = status.jbs.status !== 'sem_integracao';
            if (filtroBRF && filtroJBS) return hasBRF && hasJBS;
            if (filtroBRF) return hasBRF;
            if (filtroJBS) return hasJBS;
            return false; // Should not happen if one is checked
        });
    }

    // Define sort priority function for integration status
    const getStatusPriority = (func) => {
        const status = getIntegracaoStatus(func);
        const brfStatus = status.brf.status;
        const jbsStatus = status.jbs.status;

        // v10.9: Prioridade: 1=em_dia, 2=vencendo, 3=vencida, 4=sem_integracao
        if (brfStatus === 'vencida' || jbsStatus === 'vencida') return 3; // v11.4: Vencida (3) vem antes de Sem Integração (4)
        if (brfStatus === 'vencendo' || jbsStatus === 'vencendo') return 2;
        if (brfStatus === 'em_dia' || jbsStatus === 'em_dia') return 1;
        return 4;
    };

    // Apply primary sorting (by Status) and secondary sorting (Empresa/Nome)
    filteredFuncionarios.sort((a, b) => {
        const priorityA = getStatusPriority(a);
        const priorityB = getStatusPriority(b);
        // v11.4: A ordenação por status (prioridade) é a PRIMÁRIA
        if (priorityA !== priorityB) return priorityA - priorityB; // Sort by status first

        // Secondary sort based on user selection
        if (sortType === 'empresa') {
            const empresaA = empresas.find(e => e.id === a.empresa_id);
            const empresaB = empresas.find(e => e.id === b.empresa_id);
            const nomeEmpresaA = empresaA ? empresaA.nome : 'ZZZ'; // Put 'Sem Empresa' last
            const nomeEmpresaB = empresaB ? empresaB.nome : 'ZZZ';

            // --- MODIFICAÇÃO (Hard-coded) ---
            if (nomeEmpresaA === 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeEmpresaB !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return -1;
            if (nomeEmpresaA !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeEmpresaB === 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return 1;
            // --- FIM DA MODIFICAÇÃO ---

            if (nomeEmpresaA !== nomeEmpresaB) return nomeEmpresaA.localeCompare(nomeEmpresaB); // Sort by company name
        }
        // If same status and (same company or sorting by name), sort by employee name
        return a.nome.localeCompare(b.nome);
    });

    // --- Render List ---
    let statsVencendo = 0;
    let statsEmDia = 0;
    let statsVencida = 0; // v10.9: Adicionado contador
    let statsSemIntegracao = 0; // v11.4: Adicionado

    const renderGroup = (funcsToRender, parentElement, isGrouped = false) => {
        funcsToRender.forEach(func => {
            const status = getIntegracaoStatus(func);
            
            // v11.4: Atualiza contadores (lógica refinada)
            const brfStatus = status.brf.status;
            const jbsStatus = status.jbs.status;
            
            if (brfStatus === 'vencida' || jbsStatus === 'vencida') {
                statsVencida++;
            } else if (brfStatus === 'vencendo' || jbsStatus === 'vencendo') {
                statsVencendo++;
            } else if (brfStatus === 'em_dia' || jbsStatus === 'em_dia') {
                statsEmDia++;
            } else if (brfStatus === 'sem_integracao' && jbsStatus === 'sem_integracao') {
                statsSemIntegracao++;
            }


            const el = document.createElement('div');
            // v10.9: Removido bgColorClass, padding aumentado
            el.className = `colaborador-card !p-3`; 
            el.dataset.id = func.id;

            // v10.9: Lógica para formatar datas e cores
            const formatDate = (dateStr) => {
                if (!dateStr) return 'N/A';
                const parts = dateStr.split('-');
                if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
                return dateStr;
            };

            const getColorClass = (status) => {
                if (status === 'em_dia') return 'data-verde';
                if (status === 'vencendo') return 'data-amarela';
                if (status === 'vencida') return 'data-vermelha';
                return 'data-cinza';
            };

            const brfColorClass = getColorClass(status.brf.status);
            const jbsColorClass = getColorClass(status.jbs.status);
            const brfDate = formatDate(status.brf.data_validade);
            const jbsDate = formatDate(status.jbs.data_validade);
            
            let brfText = `BRF: ${brfDate}`;
            if (status.brf.status === 'vencendo' && status.brf.dias_restantes !== null) {
                brfText += ` (${status.brf.dias_restantes}d)`;
            }
             let jbsText = `JBS: ${jbsDate}`;
            if (status.jbs.status === 'vencendo' && status.jbs.dias_restantes !== null) {
                jbsText += ` (${status.jbs.dias_restantes}d)`;
            }
            
            // v10.9: Layout atualizado (Nome - Cargo) e datas empilhadas
            el.innerHTML = `
                <div class="colaborador-info" title="${func.nome} - ${func.cargo || 'N/A'}">
                    <strong class="nome text-sm">${func.nome}</strong>
                    ${func.cargo ? `<span class="cargo text-xs text-gray-400"> - ${func.cargo}</span>` : ''}
                    ${!isGrouped ? `<span class="text-xs text-gray-500 ml-2">(${empresas.find(e => e.id === func.empresa_id)?.nome || 'Sem Empresa'})</span>` : ''}
                </div>
                <div class="integracao-datas">
                    <p class="${brfColorClass}" title="${brfText}">${brfText}</p>
                    <p class="${jbsColorClass}" title="${jbsText}">${jbsText}</p>
                </div>`;
            parentElement.appendChild(el);
        });
    };

    if (sortType === 'empresa') {
        const grouped = filteredFuncionarios.reduce((acc, func) => {
            const empresaId = func.empresa_id || 'sem_empresa';
            if (!acc[empresaId]) acc[empresaId] = [];
            acc[empresaId].push(func);
            return acc;
        }, {});

        const sortedEmpresaIds = Object.keys(grouped).sort((a, b) => {
            const empresaA = empresas.find(e => e.id === a);
            const empresaB = empresas.find(e => e.id === b);
            const nomeA = empresaA ? empresaA.nome : 'ZZZ';
            const nomeB = empresaB ? empresaB.nome : 'ZZZ';
            
            // --- MODIFICAÇÃO (Hard-coded) ---
            if (nomeA === 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeB !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return -1;
            if (nomeA !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeB === 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return 1;
            // --- FIM DA MODIFICAÇÃO ---

            return nomeA.localeCompare(nomeB);
        });

        sortedEmpresaIds.forEach(empresaId => {
            const empresaNome = (empresas.find(e => e.id === empresaId) || {nome: 'Sem Empresa'}).nome;
            const groupContainer = document.createElement('div');
            groupContainer.className = 'empresa-group !p-3 !mb-4';
            const listEl = document.createElement('div');
            listEl.className = 'space-y-1.5'; // v10.9: Adiciona espaço entre os cards
            groupContainer.innerHTML = `<h4 class="font-semibold text-blue-300 mb-2">${empresaNome}</h4>`;

            renderGroup(grouped[empresaId], listEl, true); // true = is grouped by company

            groupContainer.appendChild(listEl);
            container.appendChild(groupContainer);
        });

    } else { // Sort by name
        renderGroup(filteredFuncionarios, container, false); // false = not grouped by company
        container.classList.add('space-y-1.5'); // v10.9: Adiciona espaço entre os cards
    }

    // Update stats
    // v11.4: Atualiza estatísticas totais (independente do filtro de status, mas dependente dos filtros BRF/JBS)
    // Recalcula estatísticas com base na lista *antes* do filtro de status, mas *depois* do filtro BRF/JBS
    let statsTotalVencida = 0;
    let statsTotalVencendo = 0;
    let statsTotalEmDia = 0;
    
    // Lista para estatísticas: aplica apenas filtros BRF/JBS
    let statsFuncionarios = [...funcionarios];
    if (filtroBRF || filtroJBS) {
        statsFuncionarios = statsFuncionarios.filter(func => {
            const status = getIntegracaoStatus(func);
            const hasBRF = status.brf.status !== 'sem_integracao';
            const hasJBS = status.jbs.status !== 'sem_integracao';
            if (filtroBRF && filtroJBS) return hasBRF && hasJBS;
            if (filtroBRF) return hasBRF;
            if (filtroJBS) return hasJBS;
            return false;
        });
    }
    
    statsFuncionarios.forEach(func => {
        const status = getIntegracaoStatus(func);
        const brfStatus = status.brf.status;
        const jbsStatus = status.jbs.status;
        
        if (brfStatus === 'vencida' || jbsStatus === 'vencida') {
            statsTotalVencida++;
        } else if (brfStatus === 'vencendo' || jbsStatus === 'vencendo') {
            statsTotalVencendo++;
        } else if (brfStatus === 'em_dia' || jbsStatus === 'em_dia') {
            statsTotalEmDia++;
        }
    });

    document.getElementById('integracaoStatsVencendo').textContent = statsTotalVencendo;
    document.getElementById('integracaoStatsEmDia').textContent = statsTotalEmDia;
    document.getElementById('integracaoStatsVencida').textContent = statsTotalVencida;

     if (filteredFuncionarios.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">Nenhum colaborador encontrado com os filtros selecionados.</p>';
    }

};


const handleObraForm = async () => {
    // Prevent non-authorized users from saving
    if (currentUser.perfil === 'Visualizacao') {
        showToast("Usuário de visualização não pode salvar.", 'error');
        return;
    }
    const form = document.getElementById('obraForm');
    // Basic HTML5 validation check
    if(!form.checkValidity()) { form.reportValidity(); return; }

    // v11.2: Seta a flag ANTES de salvar no DB para evitar "race condition" com onSnapshot
    preserveSortOrderOnNextRender = true;

    // Update the temporary pedido/etapa data from the form fields
    updateTempPedidosFromForm();

    // --- Validate Etapa Date Overlaps within the same group ---
    for (const pedido of tempPedidos) {
        const etapasGrouped = (pedido.etapas || []).reduce((acc, et) => {
            if (et.nome) { // Group by name
                if (!acc[et.nome]) acc[et.nome] = [];
                acc[et.nome].push(et);
            }
            return acc;
        }, {});

        for (const groupName in etapasGrouped) {
            const group = etapasGrouped[groupName];
            if (group.length > 1) {
                // Sort by start date to check consecutive overlaps
                const sortedGroup = group.sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
                for (let i = 0; i < sortedGroup.length - 1; i++) {
                    const e1 = sortedGroup[i];
                    const e2 = sortedGroup[i+1];
                    // Check if end date of e1 is on or after start date of e2
                    if (new Date(e1.data_fim) >= new Date(e2.data_inicio)) {
                        preserveSortOrderOnNextRender = false; // v11.2: Reseta a flag se houver erro de validação
                        showToast(`Conflito de datas na etapa "${groupName}". A data final de uma tarefa não pode ser igual ou maior que a data inicial da seguinte.`, 'error');
                        return; // Stop saving
                    }
                }
            }
        }
    }

    const id = document.getElementById('obraId').value;
    const obraData = {
        nome: document.getElementById('obraNome').value,
        numero: document.getElementById('obraNumero').value,
        cliente: document.getElementById('obraCliente').value,
        pedidos: tempPedidos.map(p => ({ // Ensure new etapas get the visualizacaoRH field
            ...p,
            etapas: (p.etapas || []).map(e => ({
                ...e,
                visualizacaoRH: e.visualizacaoRH ?? false // Default to false if missing
            }))
        })),
    };

    const originalObra = id ? obras.find(o => o.id === id) : {}; // Get original data for logging changes

    try {
        if (id) { // --- UPDATE EXISTING OBRA ---
            obraData.lastUpdate = new Date();
            const docRef = doc(obrasCollection, id);
            await updateDoc(docRef, obraData);
            logInteraction('update_obra', { id: docRef.id });

            // --- Log specific changes ---
            if(originalObra.nome !== obraData.nome) {
                await logActivity(id, `renomeou o projeto de "${originalObra.nome}" para "${obraData.nome}".`);
            }
            // Compare pedidos and etapas for detailed logs
            const originalPedidosMap = new Map((originalObra.pedidos || []).map(p => [p.id, p]));
            for (const newPedido of obraData.pedidos) {
                const originalPedido = originalPedidosMap.get(newPedido.id);
                if (!originalPedido) { // Pedido was added (should ideally not happen via update form like this)
                     await logActivity(id, `adicionou o pedido "${newPedido.numero}".`);
                     continue;
                }
                // Compare pedido number
                 if (originalPedido.numero !== newPedido.numero) {
                    await logActivity(id, `renomeou o pedido "${originalPedido.numero}" para "${newPedido.numero}".`);
                 }

                // Compare etapas within the pedido
                const originalEtapasMap = new Map((originalPedido.etapas || []).map(e => [e.id, e]));
                for (const newEtapa of (newPedido.etapas || [])) {
                    const originalEtapa = originalEtapasMap.get(newEtapa.id);
                    const etapaIdentifier = getEtapaLogIdentifier(newPedido, newEtapa.id);

                    if (!originalEtapa) { // Etapa was added
                        await logActivity(id, `criou a etapa ${etapaIdentifier} no pedido "${newPedido.numero}".`);
                    } else { // Etapa existed, check for changes
                        if (originalEtapa.nome !== newEtapa.nome) {
                            await logActivity(id, `renomeou a etapa "${originalEtapa.nome}" para ${etapaIdentifier} no pedido "${newPedido.numero}".`);
                        }
                        if (originalEtapa.data_inicio !== newEtapa.data_inicio) {
                            await logActivity(id, `alterou a data de início da etapa ${etapaIdentifier} no pedido "${newPedido.numero}" de ${originalEtapa.data_inicio || 'N/A'} para ${newEtapa.data_inicio || 'N/A'}.`);
                        }
                        if (originalEtapa.data_fim !== newEtapa.data_fim) {
                            await logActivity(id, `alterou a data final da etapa ${etapaIdentifier} no pedido "${newPedido.numero}" de ${originalEtapa.data_fim || 'N/A'} para ${newEtapa.data_fim || 'N/A'}.`);
                        }
                    }
                }
                 // Check for removed etapas
                 for (const originalEtapa of (originalPedido.etapas || [])) {
                    if (!(newPedido.etapas || []).find(e => e.id === originalEtapa.id)) {
                        const etapaIdentifier = getEtapaLogIdentifier(originalPedido, originalEtapa.id);
                        await logActivity(id, `removeu a etapa ${etapaIdentifier} do pedido "${originalPedido.numero}".`);
                    }
                }
            }
             // Check for removed pedidos
            for(const originalPedido of (originalObra.pedidos || [])) {
                if (!obraData.pedidos.find(p => p.id === originalPedido.id)) {
                    await logActivity(id, `removeu o pedido "${originalPedido.numero}".`);
                }
            }


        } else { // --- CREATE NEW OBRA ---
            obraData.createdAt = new Date();
            obraData.finalizada = false; // Default values for new obra
            obraData.pendencias = [];
            obraData.observacoes = "";
            // Initial activity log entry
            obraData.activityLog = [{
                user: currentUser.nome,
                message: `criou o projeto "${obraData.nome}".`,
                timestamp: new Date()
            }];
            const docRef = await addDoc(obrasCollection, obraData);
            logInteraction('create_obra', { id: docRef.id });
            // Automatically add new project to active list and manual sort order
            if(!activeProjectIds.includes(docRef.id)) {
                activeProjectIds.push(docRef.id);
                await setDoc(doc(settingsCollection, 'activeProjects'), { ids: activeProjectIds });
            }
            if (!obraOrder.includes(docRef.id)) {
                obraOrder.unshift(docRef.id); // Add to the beginning
                await setDoc(doc(settingsCollection, 'obraOrder'), { order: obraOrder });
            }
            // **BUG FIX:** Force re-render after adding new project
            lastKnownScrollLeft = null; // Reset scroll as it's a new project
            renderGanttChart(); // <<--- ADDED THIS LINE
        }

        // Preserve scroll if updating, otherwise it might have been reset
        if (id) {
           lastKnownScrollLeft = document.querySelector('#ganttChartContainer .gantt-timeline')?.scrollLeft ?? lastKnownScrollLeft;
        }
        closeModal(document.getElementById('obraModal'));
        showToast(`Projeto "${obraData.nome}" salvo com sucesso!`);
    } catch (error) { 
        console.error("Erro ao salvar projeto: ", error); 
        logInteraction('error_save_obra', { error });
        preserveSortOrderOnNextRender = false; // v11.2: Reseta a flag em caso de erro no salvamento
    }
};


const handleEmpresaForm = async (e) => {
    e.preventDefault();
    if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }
    const form = e.target;
    if(!form.checkValidity()) { form.reportValidity(); return; }
    const id = document.getElementById('empresaId').value;
    const empresaData = {
        nome: document.getElementById('empresaNome').value,
        tipo: document.getElementById('empresaTipo').value,
    };
    try {
        // --- MODIFICAÇÃO v10.5 (Ponto 1) ---
        // const docRef = id ? doc(empresasCollection, id) : collection(empresasCollection); // Get ref for addDoc or setDoc
        if(id) {
             await setDoc(doc(empresasCollection, id), empresaData, { merge: true }); // Update existing
             logInteraction('update_empresa', { id: id, data: empresaData });
        } else {
            const docRef = await addDoc(empresasCollection, empresaData); // Create new
            logInteraction('create_empresa', { id: docRef.id, data: empresaData });
        }
        // --- FIM DA MODIFICAÇÃO ---
        
        closeModal(document.getElementById('empresaModal'));
        showToast(`Empresa "${empresaData.nome}" salva com sucesso!`);
    } catch (error) { console.error("Erro ao salvar empresa: ", error); logInteraction('error_save_empresa', { error }); }
};
const handleFuncionarioForm = async (e) => {
    e.preventDefault();
    if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }
    const form = e.target;
    if(!form.checkValidity()) { form.reportValidity(); return; }
    const id = document.getElementById('funcionarioId').value;
    const funcionarioData = {
        nome: document.getElementById('funcionarioNome').value,
        cargo: document.getElementById('funcionarioCargo').value,
        empresa_id: document.getElementById('funcionarioEmpresaId').value,
        integracaoBRF: document.getElementById('funcionarioIntegracaoBRF').value || null, // Save null if empty
        integracaoJBS: document.getElementById('funcionarioIntegracaoJBS').value || null, // Save null if empty
    };
    try {
         // --- MODIFICAÇÃO v10.5 (Ponto 1) ---
        if(id) {
             await setDoc(doc(funcionariosCollection, id), funcionarioData, { merge: true });
             logInteraction('update_funcionario', { id: id, data: funcionarioData });
        } else {
             const docRef = await addDoc(funcionariosCollection, funcionarioData);
             logInteraction('create_funcionario', { id: docRef.id, data: funcionarioData });
        }
        // --- FIM DA MODIFICAÇÃO ---

        closeModal(document.getElementById('funcionarioModal'));
        showToast(`Funcionário "${funcionarioData.nome}" salvo com sucesso!`);
    } catch (error) { console.error("Erro ao salvar funcionário: ", error); logInteraction('error_save_funcionario', { error });}
};
const openObraModal = (obra = {}) => {
    document.getElementById('obraForm').reset();
    document.getElementById('obraId').value = obra.id || '';
    document.getElementById('obraModalTitle').textContent = obra.id ? `Editar Projeto: ${obra.nome}` : 'Novo Projeto';
    document.getElementById('obraNome').value = obra.nome || '';
    document.getElementById('obraNumero').value = obra.numero || '';
    document.getElementById('obraCliente').value = obra.cliente || '';
    // Deep copy pedidos to avoid modifying the original data directly
    tempPedidos = JSON.parse(JSON.stringify(obra.pedidos || []));
    // Show/hide buttons based on whether it's a new or existing obra
    document.getElementById('deleteObraBtn').style.display = obra.id ? 'block' : 'none';
    document.getElementById('generateObraReportBtn').style.display = obra.id ? 'block' : 'none';
    document.getElementById('activityLogBtn').style.display = obra.id ? 'block' : 'none';
    document.getElementById('pendenciasFromObraModalBtn').style.display = obra.id ? 'block' : 'none';
    renderPedidosForm(); // Render the form sections for pedidos and etapas
    openModal(document.getElementById('obraModal')); // Open the modal
};
const renderPedidosForm = () => {
    const container = document.getElementById('pedidosContainer');
    container.innerHTML = '';
    // Show placeholder if there are no pedidos
    if (tempPedidos.length === 0) {
         container.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">Nenhum pedido. Clique em "+ Adicionar Pedido" para começar.</p>';
    }
    tempPedidos.forEach(pedido => {
        const pedidoEl = document.createElement('div');
        pedidoEl.className = 'p-3 bg-gray-700/50 rounded-lg pedido-form-item';
        pedidoEl.dataset.id = pedido.id;
        let etapasHTML = '<div class="space-y-2 mt-3">';
        // Render each etapa within the pedido
        (pedido.etapas || []).forEach(etapa => {
             etapasHTML += `<div class="etapa-item grid grid-cols-12 gap-2 items-center" data-id="${etapa.id}">
                    <input type="text" value="${etapa.nome}" placeholder="Nome da Etapa" class="col-span-5 p-1 text-sm bg-gray-600 border-gray-500 rounded etapa-nome" required>
                    <input type="date" value="${etapa.data_inicio || ''}" class="col-span-3 p-1 text-sm bg-gray-600 border-gray-500 rounded etapa-inicio" required>
                    <input type="date" value="${etapa.data_fim || ''}" class="col-span-2 p-1 text-sm bg-gray-600 border-gray-500 rounded etapa-fim" required>
                    <button type="button" class="copy-etapa-btn action-btn text-blue-400 hover:text-blue-300" title="Copiar Etapa">
                        <svg class="h-5 w-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    </button>
                    <button type="button" class="remove-etapa-btn action-btn text-red-500 hover:text-red-400" title="Remover Etapa">
                        <svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd" /></svg>
                    </button>
                </div>`;
        });
        etapasHTML += '</div>';
        // Assemble pedido element HTML
        pedidoEl.innerHTML = `<div class="flex justify-between items-center">
                <div class="flex items-center gap-2 flex-grow">
                    <label class="font-semibold text-sm">Pedido Nº:</label>
                    <input type="text" value="${pedido.numero}" placeholder="Número" class="pedido-numero p-2 bg-gray-600 border-gray-500 rounded-lg w-40 text-sm" required>
                </div>
                <div>
                     <button type="button" class="add-etapa-btn bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1 px-2 rounded">+ Etapa</button>
                     <button type="button" class="remove-pedido-btn action-btn text-red-500 hover:text-red-400 p-1"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd" /></svg></button>
                </div>
            </div>
            ${etapasHTML}`;
        container.appendChild(pedidoEl);
    });
    // Add validation listeners for date inputs to ensure end date >= start date
    container.querySelectorAll('.etapa-item').forEach(etapaEl => {
        const inicioInput = etapaEl.querySelector('.etapa-inicio');
        const fimInput = etapaEl.querySelector('.etapa-fim');

        inicioInput.addEventListener('change', () => {
            if (inicioInput.value) {
                fimInput.min = inicioInput.value; // Set min attribute of end date
                // Auto-adjust end date if it becomes invalid
                if (!fimInput.value || new Date(fimInput.value) < new Date(inicioInput.value)) {
                    fimInput.value = inicioInput.value;
                }
            } else {
                fimInput.min = ''; // Remove min attribute if start date is cleared
            }
        });

        fimInput.addEventListener('change', () => {
            if (fimInput.value && inicioInput.value) {
               // Auto-adjust start date if it becomes invalid (less common case)
               if (new Date(inicioInput.value) > new Date(fimInput.value)) {
                   inicioInput.value = fimInput.value;
                   fimInput.min = inicioInput.value; // Re-set min attribute
               }
            }
        });

        // Set initial min attribute for end date if start date is pre-filled
        if (inicioInput.value) fimInput.min = inicioInput.value;
    });
};
const updateTempPedidosFromForm = () => {
     // Read data from the form elements and update the `tempPedidos` array
     tempPedidos = Array.from(document.querySelectorAll('.pedido-form-item')).map(pedidoEl => {
        const pedidoId = pedidoEl.dataset.id;
        const originalPedido = tempPedidos.find(p => p.id === pedidoId) || {}; // Find original to preserve unchanged data
         return {
            id: pedidoId,
            numero: pedidoEl.querySelector('.pedido-numero').value,
            etapas: Array.from(pedidoEl.querySelectorAll('.etapa-item')).map(etapaEl => {
                const etapaId = etapaEl.dataset.id;
                const originalEtapa = (originalPedido.etapas || []).find(e => e.id === etapaId) || {};
                // Merge original data with form data
                return {
                    ...originalEtapa, // Keep existing fields like alocados, procedures, etc.
                    id: etapaId,
                    nome: etapaEl.querySelector('.etapa-nome').value,
                    data_inicio: etapaEl.querySelector('.etapa-inicio').value,
                    data_fim: etapaEl.querySelector('.etapa-fim').value,
                    // visualizacaoRH defaults to false if not present (handled in handleObraForm)
                };
            })
        };
    });
};
const createColaboradorCard = (func, conflictInfo = null, options = {}) => {
    // v10.10 - Esta função renderiza o card na MODAL DE ALOCAÇÃO
    const { isDimmed = false, integracaoStatus = null, occupiedDetailsMap = null } = options;
    const card = document.createElement('div');
    card.className = 'colaborador-card'; // Estilo base do card
    card.dataset.id = func.id;

    // Determina o status da tag
    const status = integracaoStatus || getIntegracaoStatus(func);
    const brfStatus = status.brf.status;
    const jbsStatus = status.jbs.status;

    // Define a cor da tag (verde, amarela, vermelha)
    const getTagClass = (s) => {
        if (s === 'em_dia') return 'tag-verde';
        if (s === 'vencendo') return 'tag-amarela';
        if (s === 'vencida') return 'tag-vermelha';
        return ''; // Sem tag
    };

    const brfTagClass = getTagClass(brfStatus);
    const jbsTagClass = getTagClass(jbsStatus);
    
    // Aplica fundo de conflito se houver
    if (conflictInfo) {
        card.classList.add('conflict');
        card.title = conflictInfo;
    } else if (isDimmed) {
        card.style.opacity = '0.5';
        card.style.cursor = 'not-allowed';
        card.title = (occupiedDetailsMap && occupiedDetailsMap.get(func.id)) || 'Ocupado em outra tarefa neste período.';
    }

    // v10.10: Layout Corrigido (Linha Única com flex justify-between)
    // (Nome - Cargo) ............................ [BRF] [JBS]
    card.innerHTML = `
        <div class="colaborador-card-content">
            <div class="colaborador-info" title="${func.nome}${func.cargo ? ` - ${func.cargo}` : ''}">
                ${func.nome}
                ${func.cargo ? `<span class="cargo"> - ${func.cargo}</span>` : ''}
            </div>
            <div class="integracao-tags">
                ${brfTagClass ? `<span class="tag-integracao ${brfTagClass}">BRF</span>` : ''}
                ${jbsTagClass ? `<span class="tag-integracao ${jbsTagClass}">JBS</span>` : ''}
            </div>
        </div>
    `;
    
    return card;
};


const createMiniColaboradorCard = (func) => {
     const card = document.createElement('div');
     card.className = 'colaborador-card !p-1 !text-xs'; // Smaller card style
     card.dataset.id = func.id;
     card.innerHTML = `<strong class="nome">${func.nome}</strong>`;
     return card;
}

// --- LÓGICA DE ALOCAÇÃO (MODAL) ---
// --- LÓGICA DE ALOCAÇÃO (MODAL) ---
const renderAlocacaoLists = (fromSortOrFilter = false) => {
    const [obra, pedido, etapa] = findEtapaParents(currentAlocacaoEtapaId);
    if (!etapa) return;

    // --- Update Navigator ---
    const navigatorContainer = document.getElementById('etapaNavigator');
    if (navigatorContainer) {
        const { group, index } = currentEtapaGroupContext;
        if (group && group.length > 1) {
            navigatorContainer.classList.remove('hidden');
            document.getElementById('etapaNavigatorText').textContent = `Etapa (${index + 1} de ${group.length})`;
            document.getElementById('etapaNavPrev').disabled = index === 0;
            document.getElementById('etapaNavNext').disabled = index === group.length - 1;
        } else {
            navigatorContainer.classList.add('hidden');
        }
    }

    // --- Determine Occupied Employees ---
    const etapaStart = new Date(etapa.data_inicio + 'T00:00:00');
    const etapaEnd = new Date(etapa.data_fim + 'T00:00:00');
    const occupiedFuncIds = new Set(); // Employees busy elsewhere during this etapa's period
    const occupiedFuncDetails = new Map(); // Details about where they are busy

    obras.forEach(o => {
        (o.pedidos || []).forEach(p => {
            (p.etapas || []).forEach(e => {
                if (e.id === etapa.id) return; // Skip the current etapa
                if (e.data_inicio && e.data_fim) {
                    const otherStart = new Date(e.data_inicio + 'T00:00:00');
                    const otherEnd = new Date(e.data_fim + 'T00:00:00');
                    // Check for date overlap
                    if (etapaStart <= otherEnd && otherStart <= etapaEnd) {
                        (e.colaboradores_alocados || []).forEach(id => {
                            occupiedFuncIds.add(id);
                            // Store details for tooltip/dimming
                            if (!occupiedFuncDetails.has(id)) {
                                occupiedFuncDetails.set(id, `Alocado em: ${o.nome} - Etapa "${e.nome}" (${e.data_inicio} a ${e.data_fim})`);
                            }
                        });
                    }
                }
            });
        });
    });

    // --- Get Current State (from DOM if sorting/filtering, else from etapa data) ---
    let alocadosIdsSet, reservassIdsSet;
    if (fromSortOrFilter) { // Read IDs directly from the lists if user interacted
        alocadosIdsSet = new Set(Array.from(document.querySelectorAll('#alocadosList .colaborador-card')).map(c => c.dataset.id));
        reservassIdsSet = new Set(Array.from(document.querySelectorAll('#reservasList .colaborador-card')).map(c => c.dataset.id));
    } else { // Read IDs from the etapa data on initial load or navigation
        alocadosIdsSet = new Set(etapa.colaboradores_alocados || []);
        reservassIdsSet = new Set(etapa.colaboradores_reserva || []);
    }

    // --- Filter and Categorize Employees ---
    const searchTerm = document.getElementById('alocacaoSearch').value.toLowerCase();
    const filtroBRF = document.getElementById('filtroBRF').checked;
    const filtroJBS = document.getElementById('filtroJBS').checked;

    let disponiveis = [];
    let alocados = [];
    let reservas = [];

    // v12.0: CORREÇÃO DO BUG DA BUSCA
    funcionarios.forEach(func => {
        // 1. Verifica se o funcionário já está alocado ou reservado.
        // Estas listas NUNCA devem ser filtradas pela busca ou filtros de integração.
        if (alocadosIdsSet.has(func.id)) {
            alocados.push(func);
            return; // Já categorizado, pula para o próximo funcionário
        }
        if (reservassIdsSet.has(func.id)) {
            reservas.push(func);
            return; // Já categorizado, pula para o próximo funcionário
        }

        // 2. Se chegou aqui, é um funcionário "Disponível".
        // AGORA aplicamos a busca e os filtros de integração.
        const nomeLower = func.nome.toLowerCase();
        const matchesSearch = nomeLower.includes(searchTerm);
        
        // Se não corresponder à busca, pula
        if (!matchesSearch) return; 

        // Verifica filtros de integração (BRF/JBS)
        const statusIntegracao = getIntegracaoStatus(func);
        const hasBRF = statusIntegracao.brf.status !== 'sem_integracao';
        const hasJBS = statusIntegracao.jbs.status !== 'sem_integracao';

        let passesIntegrationFilter = true;
        if (filtroBRF || filtroJBS) {
            if (filtroBRF && filtroJBS) passesIntegrationFilter = hasBRF && hasJBS;
            else if (filtroBRF) passesIntegrationFilter = hasBRF;
            else if (filtroJBS) passesIntegrationFilter = hasJBS;
        }

        // 3. Adiciona aos disponíveis se passar nos filtros E não estiver ocupado em outra data
        if (passesIntegrationFilter && !occupiedFuncIds.has(func.id)) { 
            disponiveis.push(func);
        }
        // Funcionários que não passam nos filtros de integração ou estão ocupados
        // simplesmente não aparecem em nenhuma das três listas.
    });


    // --- Update Counts ---
    document.getElementById('disponiveisTotalCount').textContent = `(${disponiveis.length} de ${funcionarios.length})`;
    document.getElementById('alocadosCount').textContent = `(${alocados.length})`;
    document.getElementById('reservasCount').textContent = `(${reservas.length})`;

    // --- Destroy Existing Sortables ---
    activeAlocacaoSortables.forEach(s => s.destroy());
    activeAlocacaoSortables = [];
    const sortType = document.getElementById('sortAlocacao').value;

    // --- Function to Populate a List Container ---
    const populateList = (container, funcs, listType) => {
        container.innerHTML = ''; // Clear previous content

        // --- Inner function to process and render employees ---
        const processFuncs = (listElement, funcsToProcess) => {
            // Sort employees within the list/group
            funcsToProcess.sort((a, b) => {
                 // **Integration Sort (Only for Disponiveis)**
                 if (listType === 'disponivel') {
                    const statusA = getIntegracaoStatus(a);
                    const statusB = getIntegracaoStatus(b);
                    
                    // v10.8: Lógica de prioridade atualizada (1:Verde, 2:Amarelo, 3:Vermelho, 4:N/A)
                    const getPri = (status) => {
                        if (status.brf.status === 'em_dia' || status.jbs.status === 'em_dia') return 1;
                        if (status.brf.status === 'vencendo' || status.jbs.status === 'vencendo') return 2;
                        if (status.brf.status === 'vencida' || status.jbs.status === 'vencida') return 3;
                        return 4;
                    };

                    const priorityA = getPri(statusA);
                    const priorityB = getPri(statusB);
                    
                    if (priorityA !== priorityB) return priorityA - priorityB; // Sort by integration status first
                 }
                 // Alphabetical sort as secondary or primary
                 return a.nome.localeCompare(b.nome);
            }).forEach(func => {
                let conflictInfo = null;
                // --- MODIFICAÇÃO v10.5 (Ponto 2) ---
                // O 'isDimmed' agora só se aplica a listas de 'Alocados' ou 'Reservas' se o item estiver ocupado
                // A lista 'Disponiveis' não terá mais itens "dimmed" pois eles são filtrados antes
                const isDimmed = occupiedFuncIds.has(func.id) && (listType === 'alocado' || listType === 'reserva'); 
                // --- FIM DA MODIFICAÇÃO ---


                // Check for hard conflicts (alocado list)
                if (listType === 'alocado') {
                    const etapaConflicts = conflictMap.get(currentAlocacaoEtapaId);
                    if (etapaConflicts && etapaConflicts.has(func.id)) {
                        conflictInfo = etapaConflicts.get(func.id); // Get specific conflict message
                    }
                }
                
                // --- MODIFICAÇÃO v10.5 (Ponto 3) ---
                // Obter o status de integração para passar para o createColaboradorCard
                // Isso é necessário para aplicar a cor de texto correta em caso de conflito
                const integracaoStatus = getIntegracaoStatus(func);
                // --- FIM DA MODIFICAÇÃO ---

                // Create card with appropriate styling
                 listElement.appendChild(createColaboradorCard(func, conflictInfo, {
                    isDimmed: isDimmed,
                    // --- MODIFICAÇÃO v10.5 (Ponto 3) ---
                    // Passa o status de integração para todas as listas
                    integracaoStatus: integracaoStatus, 
                    occupiedDetailsMap: occupiedFuncDetails
                 }));
            });
        };

        // --- Render based on Sort Type ---
        if (sortType === 'empresa') {
            // Group employees by company
            const grouped = funcs.reduce((acc, func) => {
                const empresaId = func.empresa_id || 'sem_empresa';
                if (!acc[empresaId]) acc[empresaId] = [];
                acc[empresaId].push(func);
                return acc;
            }, {});

            // Sort company groups (FRINOX first)
            const sortedEmpresaIds = Object.keys(grouped).sort((a, b) => {
                const empresaA = empresas.find(e => e.id === a);
                const empresaB = empresas.find(e => e.id === b);
                const nomeA = empresaA ? empresaA.nome : 'ZZZ';
                const nomeB = empresaB ? empresaB.nome : 'ZZZ';

                // --- MODIFICAÇÃO (Hard-coded) ---
                if (nomeA === 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeB !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return -1;
                if (nomeA !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeB === 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return 1;
                // --- FIM DA MODIFICAÇÃO ---

                return nomeA.localeCompare(nomeB);
            });

            // Render each company group
            sortedEmpresaIds.forEach(empresaId => {
                const empresaNome = (empresas.find(e => e.id === empresaId) || {nome: 'Sem Empresa'}).nome;
                const groupContainer = document.createElement('div');
                groupContainer.className = 'empresa-group';
                const listEl = document.createElement('div');
                listEl.className = 'space-y-1 min-h-[10px] empresa-group-list'; // Target for SortableJS
                listEl.dataset.empresaId = empresaId;

                groupContainer.innerHTML = `<h4 class="font-semibold text-blue-300 mb-2 text-sm">${empresaNome} (${grouped[empresaId].length})</h4>`;

                processFuncs(listEl, grouped[empresaId]); // Render employees within the group

                groupContainer.appendChild(listEl);
                container.appendChild(groupContainer);
                
                // --- MODIFICAÇÃO v10.5 (Ponto 5) ---
                // Remove o 'filter' e 'preventOnFilter' que causavam o bug de bloqueio
                activeAlocacaoSortables.push(new Sortable(listEl, {
                    group: { name: 'colaboradores' }, // Simplificado
                    animation: 150,
                    onEnd: () => renderAlocacaoLists(true), // Re-render after drag/drop
                 }));
                 // --- FIM DA MODIFICAÇÃO ---
            });
        } else { // 'alfabetica' sort
             processFuncs(container, funcs); // Render all employees directly in the main container
        }
    };

    // --- Populate the Three Lists ---
    populateList(document.getElementById('disponiveisList'), disponiveis, 'disponivel');
    populateList(document.getElementById('alocadosList'), alocados, 'alocado');
    populateList(document.getElementById('reservasList'), reservas, 'reserva');

    // --- Initialize SortableJS for Main Containers (needed when not grouping by company) ---
    if (sortType !== 'empresa') {
        const initSortableList = (elementId) => {
            const listEl = document.getElementById(elementId);
            // --- MODIFICAÇÃO v10.5 (Ponto 5) ---
            // Remove o 'filter' e 'preventOnFilter'
            activeAlocacaoSortables.push(new Sortable(listEl, {
                 group: { name: 'colaboradores' },
                 animation: 150,
                 onEnd: () => renderAlocacaoLists(true),
            }));
            // --- FIM DA MODIFICAÇÃO ---
        };
        initSortableList('disponiveisList');
        initSortableList('alocadosList');
        initSortableList('reservasList');
    }

    // --- Also make the parent containers sortable targets (allows dropping into empty lists or outside groups) ---
     const initMainContainerSortable = (container) => {
         activeAlocacaoSortables.push(new Sortable(container, {
            group: 'colaboradores',
            animation: 150,
            onAdd: (evt) => { // Handle dropping directly into the main container area
                // When grouped by company, find the correct company list or create one if needed
                if (sortType === 'empresa') {
                     const funcId = evt.item.dataset.id;
                     const func = funcionarios.find(f => f.id === funcId);
                     const empresaId = func?.empresa_id || 'sem_empresa';
                     let targetList = container.querySelector(`.empresa-group-list[data-empresa-id="${empresaId}"]`);
                     // If the group doesn't exist in this column yet, potentially create it or move item back (simpler: re-render)
                     // For simplicity, just re-rendering ensures correct placement.
                     renderAlocacaoLists(true);
                } else {
                    renderAlocacaoLists(true); // Re-render if not grouped
                }
            }
        }));
    }
    initMainContainerSortable(document.getElementById('disponiveisList'));
    initMainContainerSortable(document.getElementById('alocadosList'));
    initMainContainerSortable(document.getElementById('reservasList'));
};


const openAlocacaoModal = (etapaId) => {
    currentAlocacaoEtapaId = etapaId;
    const [parentObra, parentPedido, etapa] = findEtapaParents(etapaId);

    if (!etapa || !parentObra || !parentPedido) { console.error("Etapa ou seus pais não foram encontrados."); return; }

    // Find the group of etapas with the same name for navigation context
    const group = (parentPedido.etapas || []).filter(e => e.nome === etapa.nome).sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
    const index = group.findIndex(e => e.id === etapaId);
    currentEtapaGroupContext = { group, index }; // Store context for navigator buttons

    // Set modal titles
    const titleEl = document.getElementById('alocacaoModalTitle');
    const subtitleEl = document.getElementById('alocacaoModalSubtitle');
    titleEl.textContent = `Alocar em: ${etapa.nome}`;
    subtitleEl.textContent = `Projeto: ${parentObra.nome} | Pedido: ${parentPedido.numero} | Data: ${etapa.data_inicio} a ${etapa.data_fim}`; // Added dates
    document.getElementById('alocacaoSearch').value = ''; // Clear search
    // Reset integration filters
    document.getElementById('filtroBRF').checked = false;
    document.getElementById('filtroJBS').checked = false;


    // Setup or update the etapa navigator if not already present
    if (!document.getElementById('etapaNavigator')) {
        const navigatorHTML = `
            <div id="etapaNavigator" class="text-center my-2">
                <span id="etapaNavigatorText" class="font-semibold text-white"></span>
                <div class="flex justify-center items-center gap-4 mt-1">
                    <button id="etapaNavPrev" class="bg-gray-600 hover:bg-gray-500 rounded-full p-1 disabled:opacity-50">
                        <svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                    </button>
                    <button id="etapaNavNext" class="bg-gray-600 hover:bg-gray-500 rounded-full p-1 disabled:opacity-50">
                        <svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                    </button>
                </div>
            </div>`;
        subtitleEl.insertAdjacentHTML('afterend', navigatorHTML); // Add navigator below subtitle
        // Add event listeners for navigator buttons
        document.getElementById('etapaNavPrev').addEventListener('click', () => {
            const { group, index } = currentEtapaGroupContext;
            if (index > 0) openAlocacaoModal(group[index - 1].id); // Open modal for previous etapa
        });
        document.getElementById('etapaNavNext').addEventListener('click', () => {
            const { group, index } = currentEtapaGroupContext;
            if (index < group.length - 1) openAlocacaoModal(group[index + 1].id); // Open modal for next etapa
        });
    }

    // Show/Hide RH confirmation button based on profile and etapa status
    const confirmBtn = document.getElementById('confirmVisualizacaoBtn');
    if (currentUser.perfil === 'admin' || currentUser.perfil === 'RH') {
        confirmBtn.classList.remove('hidden');
        if (etapa.visualizacaoRH) {
            confirmBtn.textContent = 'Visualização Confirmada';
            confirmBtn.disabled = true;
            confirmBtn.classList.add('bg-green-700', 'hover:bg-green-700', 'cursor-not-allowed');
            confirmBtn.classList.remove('bg-teal-600', 'hover:bg-teal-700');
        } else {
            confirmBtn.textContent = 'Confirmar Visualização (RH)';
            confirmBtn.disabled = false;
            confirmBtn.classList.remove('bg-green-700', 'hover:bg-green-700', 'cursor-not-allowed');
            confirmBtn.classList.add('bg-teal-600', 'hover:bg-teal-700');
        }
    } else {
        confirmBtn.classList.add('hidden');
    }


    renderAlocacaoLists(false); // Render the lists for the first time
    openModal(document.getElementById('alocacaoModal')); // Open the modal
};

// --- CONFIRMAR VISUALIZAÇÃO RH (NOVO v10.4) ---
const handleConfirmVisualizacao = async () => {
    if (currentUser.perfil !== 'admin' && currentUser.perfil !== 'RH') {
        showToast("Apenas Admin ou RH podem confirmar.", 'error');
        return;
    }
     const [targetObra, targetPedido, targetEtapa] = findEtapaParents(currentAlocacaoEtapaId);
     if (!targetObra || !targetPedido || !targetEtapa) {
        showToast("Erro: Etapa não encontrada.", 'error');
        return;
     }

     if (targetEtapa.visualizacaoRH) {
         showToast("Visualização já confirmada.", 'info');
         return;
     }

     const obraToUpdate = obras.find(o => o.id === targetObra.id);
     const updatedPedidos = JSON.parse(JSON.stringify(obraToUpdate.pedidos));
     const pedidoToUpdate = updatedPedidos.find(p => p.id === targetPedido.id);
     const etapaToUpdate = (pedidoToUpdate.etapas || []).find(e => e.id === targetEtapa.id);

     etapaToUpdate.visualizacaoRH = true; // Set the flag to true

     try {
        const obraRef = doc(obrasCollection, obraToUpdate.id);
        await updateDoc(obraRef, { pedidos: updatedPedidos });
        logInteraction('confirm_visualizacao_rh', { etapaId: currentAlocacaoEtapaId });
        const etapaIdentifier = getEtapaLogIdentifier(pedidoToUpdate, etapaToUpdate.id);
        await logActivity(targetObra.id, `confirmou a visualização da etapa ${etapaIdentifier}.`, false); // Don't create separate notification

        // Update button state in the modal
        const confirmBtn = document.getElementById('confirmVisualizacaoBtn');
        confirmBtn.textContent = 'Visualização Confirmada';
        confirmBtn.disabled = true;
        confirmBtn.classList.add('bg-green-700', 'hover:bg-green-700', 'cursor-not-allowed');
        confirmBtn.classList.remove('bg-teal-600', 'hover:bg-teal-700');

        showToast("Visualização confirmada.");
        // No need to close modal
     } catch(error) {
        console.error("Erro ao confirmar visualização:", error);
        showToast("Erro ao confirmar visualização.", "error");
     }
};


const saveAlocacao = async () => {
    if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }

    // Get final IDs from the DOM lists
    const newAlocadosIds = Array.from(document.querySelectorAll('#alocadosList .colaborador-card')).map(c => c.dataset.id);
    const newReservasIds = Array.from(document.querySelectorAll('#reservasList .colaborador-card')).map(c => c.dataset.id);

    const [targetObra, targetPedido, targetEtapa] = findEtapaParents(currentAlocacaoEtapaId);

    if (targetObra && targetPedido && targetEtapa) {
        // --- Compare changes for logging ---
        const originalAlocados = new Set(targetEtapa.colaboradores_alocados || []);
        const newAlocados = new Set(newAlocadosIds);
        const addedAlocados = [...newAlocados].filter(id => !originalAlocados.has(id));
        const removedAlocados = [...originalAlocados].filter(id => !newAlocados.has(id));

        const originalReservas = new Set(targetEtapa.colaboradores_reserva || []);
        const newReservas = new Set(newReservasIds);
        const addedReservas = [...newReservas].filter(id => !originalReservas.has(id));
        const removedReservas = [...originalReservas].filter(id => !newReservas.has(id));

        // --- Prepare updated data ---
        const obraToUpdate = obras.find(o => o.id === targetObra.id);
        const updatedPedidos = JSON.parse(JSON.stringify(obraToUpdate.pedidos)); // Deep copy
        const pedidoToUpdate = updatedPedidos.find(p => p.id === targetPedido.id);
        const etapaToUpdate = (pedidoToUpdate.etapas || []).find(e => e.id === targetEtapa.id);

        etapaToUpdate.colaboradores_alocados = newAlocadosIds;
        etapaToUpdate.colaboradores_reserva = newReservasIds;

         // Reset visualizacaoRH flag if user is not Admin/RH and changes were made
        if ((currentUser.perfil !== 'admin' && currentUser.perfil !== 'RH') &&
            (addedAlocados.length > 0 || removedAlocados.length > 0 || addedReservas.length > 0 || removedReservas.length > 0))
        {
            etapaToUpdate.visualizacaoRH = false;
        }


        try {
            // --- Save to Firestore ---
            const obraRef = doc(obrasCollection, obraToUpdate.id);
            await updateDoc(obraRef, { pedidos: updatedPedidos });

            // --- Log specific changes ---
            const etapaIdentifier = getEtapaLogIdentifier(pedidoToUpdate, etapaToUpdate.id);
            const getNames = (ids) => ids.map(id => funcionarios.find(f => f.id === id)?.nome || id).join(', ');

            if(addedAlocados.length > 0) {
                await logActivity(targetObra.id, `alocou [${getNames(addedAlocados)}] na etapa ${etapaIdentifier} do pedido "${targetPedido.numero}".`);
            }
            if(removedAlocados.length > 0) {
                await logActivity(targetObra.id, `desalocou [${getNames(removedAlocados)}] da etapa ${etapaIdentifier} do pedido "${targetPedido.numero}".`);
            }
            if(addedReservas.length > 0) {
                await logActivity(targetObra.id, `reservou [${getNames(addedReservas)}] na etapa ${etapaIdentifier} do pedido "${targetPedido.numero}".`);
            }
            if(removedReservas.length > 0) {
                await logActivity(targetObra.id, `removeu da reserva [${getNames(removedReservas)}] na etapa ${etapaIdentifier} do pedido "${targetPedido.numero}".`);
            }
            if (etapaToUpdate.visualizacaoRH === false && targetEtapa.visualizacaoRH === true) { // Check if flag was reset
                 await logActivity(targetObra.id, `resetou a confirmação de visualização da etapa ${etapaIdentifier} devido a alterações.`);
            }


            logInteraction('save_alocacao', { etapaId: currentAlocacaoEtapaId, alocados: newAlocadosIds, reservas: newReservasIds });
            closeModal(document.getElementById('alocacaoModal'));
            showToast(`Alocação da etapa "${etapaToUpdate.nome}" salva.`);
        } catch (error) { console.error("Erro ao salvar alocação: ", error); logInteraction('error_save_alocacao', { error });}
    }
};

const findEtapaParents = (etapaId) => {
    // Helper function to find the obra, pedido, and etapa objects given an etapa ID
   for (const o of obras) {
       for (const p of (o.pedidos || [])) {
           const e = (p.etapas || []).find(et => et.id === etapaId);
           if (e) return [o, p, e]; // Return array [obra, pedido, etapa]
       }
   }
   return [null, null, null]; // Not found
};

// --- LÓGICA DE CÓPIA DE ALOCADOS ---
const enterCopyMode = (etapaId) => {
    const [,,etapa] = findEtapaParents(etapaId);
    const alocados = etapa?.colaboradores_alocados || [];

    if (alocados.length === 0) {
        showToast("Não há colaboradores alocados para copiar.", "error");
        return; // Nothing to copy
    }

    // Set global state for copy mode
    copyModeState = {
        active: true,
        sourceEtapaId: etapaId,
        colaboradoresToCopy: alocados
    };

    closeModal(document.getElementById('alocacaoModal')); // Close the alocacao modal

    // Switch to Gantt view if not already there
    if (currentTab !== 'Gantt') {
        switchTab('Gantt');
    } else {
        renderGanttChart(); // Re-render Gantt to apply copy mode styles
    }

    // Show the copy mode indicator panel
    document.getElementById('copyModePanel').classList.remove('hidden');
    document.body.classList.add('copy-mode-active'); // Add class for potential global styling/cursor changes
    logInteraction('enter_copy_mode', { sourceEtapaId: etapaId, count: alocados.length });
};

const exitCopyMode = () => {
    // Reset global state
    copyModeState = { active: false, sourceEtapaId: null, colaboradoresToCopy: [] };
    // Hide indicator panel
    document.getElementById('copyModePanel').classList.add('hidden');
    document.body.classList.remove('copy-mode-active');
    renderGanttChart(); // Re-render Gantt to remove copy mode styles
    logInteraction('exit_copy_mode', {});
};

// --- LÓGICA DE INFO ETAPA (MODAL) ---
const openInfoEtapaModal = (etapaId) => {
    currentInfoEtapaId = etapaId; // Store the ID of the currently viewed etapa
    const modal = document.getElementById('infoEtapaModal');
    document.getElementById('infoEtapaId').value = etapaId; // Set hidden input value
    const [parentObra, parentPedido, etapa] = findEtapaParents(etapaId);
    if (!etapa) { console.error("Etapa não encontrada"); return; }

    // --- Setup Navigator ---
    const navigatorContainer = document.getElementById('infoEtapaNavigator');
    // Find the group of etapas with the same name for navigation
    const group = (parentPedido.etapas || [])
        .filter(e => e.nome === etapa.nome)
        .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
    const index = group.findIndex(e => e.id === etapaId);
    currentInfoEtapaGroupContext = { group, index }; // Store context

    // Show/hide navigator based on group size
    if (group.length > 1) {
        navigatorContainer.classList.remove('hidden');
        document.getElementById('infoEtapaNavigatorText').textContent = `Etapa (${index + 1} de ${group.length})`;
        document.getElementById('infoEtapaNavPrev').disabled = index === 0; // Disable prev if first
        document.getElementById('infoEtapaNavNext').disabled = index === group.length - 1; // Disable next if last
    } else {
        navigatorContainer.classList.add('hidden');
    }

    // --- Populate Basic Info ---
    document.getElementById('infoEtapaModalTitle').textContent = `Informações da Etapa: ${etapa.nome}`;
    document.getElementById('infoEtapaModalSubtitle').textContent = `Projeto: ${parentObra.nome} | Pedido: ${parentPedido.numero}`;
    document.getElementById('infoEtapaNome').textContent = etapa.nome || 'N/A';
    document.getElementById('infoEtapaInicio').textContent = etapa.data_inicio ? new Date(etapa.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR') : 'N/A';
    document.getElementById('infoEtapaFim').textContent = etapa.data_fim ? new Date(etapa.data_fim + 'T00:00:00').toLocaleDateString('pt-BR') : 'N/A';

    // --- Populate Form Fields ---
    document.getElementById('infoClienteNome').value = parentObra.cliente || ''; // Readonly field
    document.getElementById('infoClienteTelefone').value = etapa.clienteTelefone || '';
    document.getElementById('infoClienteEmail').value = etapa.clienteEmail || '';
    document.getElementById('infoEncarregado').value = etapa.encarregado || '';
    document.getElementById('infoDescricao').value = etapa.descricao || '';

    // --- Render Dynamic Sections ---
    renderComentarios(etapa); // Render comments section
    renderLogisticaList(etapa.logistica || []); // Render logistics section
    renderProcedimentos(etapa.procedimentos || {}); // Render RH procedures section
    document.getElementById('infoResponsavelNome').value = etapa.procedimentos?.responsavel || ''; // Populate responsible person
    renderHotelLists(etapa.colaboradores_alocados || [], etapa.hotelaria || {}); // Render hotel allocation section

    openModal(modal); // Open the modal
};

const refreshInfoEtapaModalContent = () => {
    // Refreshes the content of the Info Etapa modal if it's open
    // Useful when underlying data changes due to Firestore updates
    if (!currentInfoEtapaId) return; // Exit if no etapa is currently being viewed

    const [parentObra, parentPedido, etapa] = findEtapaParents(currentInfoEtapaId);

    // If the etapa (or its parents) no longer exists, close the modal
    if (!etapa || !parentObra || !parentPedido) {
        const modal = document.getElementById('infoEtapaModal');
        if (modal && !modal.classList.contains('hidden')) { // Check if modal is actually open
            closeModal(modal);
            showToast("A etapa que você estava visualizando foi removida ou alterada.", "error");
            currentInfoEtapaId = null; // Reset the current ID
        }
        return;
    }

    // --- Re-populate only the fields that might change frequently ---
    // Basic info (Nome, Datas) usually changes via Obra modal, less likely here.
    // Client Name is read-only.
    document.getElementById('infoClienteTelefone').value = etapa.clienteTelefone || '';
    document.getElementById('infoClienteEmail').value = etapa.clienteEmail || '';
    document.getElementById('infoEncarregado').value = etapa.encarregado || '';
    document.getElementById('infoDescricao').value = etapa.descricao || '';

    // --- Re-render dynamic sections ---
    renderComentarios(etapa);
    renderLogisticaList(etapa.logistica || []);
    renderProcedimentos(etapa.procedimentos || {});
    document.getElementById('infoResponsavelNome').value = etapa.procedimentos?.responsavel || '';
    // Re-render hotel lists, passing the potentially updated list of allocated employees
    renderHotelLists(etapa.colaboradores_alocados || [], etapa.hotelaria || {});
};


// --- LÓGICA DE COMENTÁRIOS ---
const renderComentarios = (etapa) => {
    const container = document.getElementById('comentariosContainer');
    container.innerHTML = '';
    const comentarios = etapa.comentarios || [];

    // Show placeholder if no comments
    if (comentarios.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">Nenhum comentário ainda.</p>';
        return;
    }

    // Preserve original index for editing/deleting, then sort by timestamp
    const sortedComentarios = [...comentarios]
        .map((c, index) => ({...c, originalIndex: index })) // Add original index
        .sort((a, b) => {
            // Handle both Firestore Timestamps and JS Date objects
            const dateA = a.timestamp?.toDate ? a.timestamp.toDate() : (a.timestamp ? new Date(a.timestamp) : 0);
            const dateB = b.timestamp?.toDate ? b.timestamp.toDate() : (b.timestamp ? new Date(b.timestamp) : 0);
            return dateA - dateB; // Sort ascending (oldest first)
        });

    // Render each comment using the template
    sortedComentarios.forEach(c => {
        const commentTemplate = document.getElementById('comment-template').content.cloneNode(true);
        const commentItem = commentTemplate.querySelector('.comment-item');

        commentItem.dataset.index = c.originalIndex; // Store original index for actions
        commentItem.querySelector('.comment-user').textContent = c.user;

        // Format and display the timestamp
        const dateCell = commentItem.querySelector('.comment-date');
        let date = null;
        if (c.timestamp?.toDate) { date = c.timestamp.toDate(); } // Firestore Timestamp
        else if (c.timestamp instanceof Date || (typeof c.timestamp === 'string' && !isNaN(new Date(c.timestamp)))) { date = new Date(c.timestamp); } // JS Date or valid date string
        else if (typeof c.timestamp === 'object' && c.timestamp !== null && typeof c.timestamp.seconds === 'number') { date = new Date(c.timestamp.seconds * 1000); } // Object from JSON.parse

        if (date && !isNaN(date)) {
            dateCell.textContent = date.toLocaleString('pt-BR');
            // Add '(editado)' indicator if applicable
            if (c.editadoEm) {
                const editedSpan = document.createElement('span');
                editedSpan.className = 'text-xs text-gray-500 ml-2';
                editedSpan.textContent = '(editado)';
                dateCell.appendChild(editedSpan);
            }
        } else {
            dateCell.textContent = 'Data indisponível'; // Fallback
        }

        commentItem.querySelector('.comment-text').textContent = c.texto; // Display comment text

        // Add edit/delete actions if the current user is admin or the comment author
        const actionsContainer = commentItem.querySelector('.comment-actions');
        if (currentUser && (currentUser.perfil === 'admin' || currentUser.nome === c.user)) {
            const actionsTemplate = document.getElementById('comment-actions-template').content.cloneNode(true);
            actionsContainer.appendChild(actionsTemplate);
        }

        container.appendChild(commentItem);
    });
    // Scroll to the bottom to show the latest comments
    container.scrollTop = container.scrollHeight;
};

const handleComentarioForm = async (e) => {
    e.preventDefault();
    if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }

    const input = document.getElementById('novoComentarioInput');
    const texto = input.value.trim();
    if (!texto) return; // Ignore empty comments

    const [targetObra, targetPedido, ] = findEtapaParents(currentInfoEtapaId); // Find parent obra and pedido
    if (!targetObra || !targetPedido) {
        showToast("Falha ao salvar comentário: Obra ou Pedido não encontrado.", 'error');
        return;
    }

    const novoComentario = {
        user: currentUser.nome,
        texto: texto,
        timestamp: new Date() // Use client-side date for immediate display consistency
    };

    try {
        const obraRef = doc(obrasCollection, targetObra.id);

        // --- Fetch latest data before updating ---
        // This is crucial to avoid overwriting concurrent changes made by others
        const obraSnap = await getDoc(obraRef);
        if (!obraSnap.exists()) throw new Error("Obra não encontrada para adicionar comentário.");

        const obraToUpdate = obraSnap.data();
        // Find the correct pedido and etapa within the fetched data
        const pedidoToUpdate = obraToUpdate.pedidos.find(p => p.id === targetPedido.id);
        if (!pedidoToUpdate) throw new Error("Pedido não encontrado dentro da Obra.");
        const etapaToUpdate = pedidoToUpdate.etapas.find(e => e.id === currentInfoEtapaId);
        if (!etapaToUpdate) throw new Error("Etapa não encontrada dentro do Pedido.");

        // Add the new comment to the array (initialize if it doesn't exist)
        if (!etapaToUpdate.comentarios) etapaToUpdate.comentarios = [];
        etapaToUpdate.comentarios.push(novoComentario);

        // --- Update the entire 'pedidos' array in Firestore ---
        await updateDoc(obraRef, { pedidos: obraToUpdate.pedidos });

        input.value = ''; // Clear the input field

        logInteraction('add_comment', { etapaId: currentInfoEtapaId, texto });
        const etapaIdentifier = getEtapaLogIdentifier(pedidoToUpdate, currentInfoEtapaId);
        await logActivity(targetObra.id, `adicionou um comentário na etapa ${etapaIdentifier}.`);
        // The UI will be updated automatically by the onSnapshot listener for the 'obras' collection

    } catch (error) {
        showToast("Falha ao salvar comentário.", 'error');
        console.error("Erro ao salvar comentário:", error);
    }
};

const handleDeleteComentario = async (commentIndex) => {
     // Find parent obra using the currentInfoEtapaId
    const [targetObra, targetPedido, ] = findEtapaParents(currentInfoEtapaId);
    if (!targetObra || !targetPedido) {
        showToast("Erro: Obra ou Pedido não encontrado.", "error");
        return;
    }

    // Show confirmation dialog before deleting
    showConfirmModal("Excluir Comentário", "Tem certeza que deseja excluir este comentário? Esta ação é irreversível.", async () => {
        try {
            const obraRef = doc(obrasCollection, targetObra.id);
             // --- Fetch latest data before updating ---
            const obraSnap = await getDoc(obraRef);
            if (!obraSnap.exists()) throw new Error("Obra não encontrada para excluir comentário.");

            const obraToUpdate = obraSnap.data();
            const pedidoToUpdate = obraToUpdate.pedidos.find(p => p.id === targetPedido.id);
            if (!pedidoToUpdate) throw new Error("Pedido não encontrado.");
            const etapaToUpdate = pedidoToUpdate.etapas.find(e => e.id === currentInfoEtapaId);
            if (!etapaToUpdate || !etapaToUpdate.comentarios) throw new Error("Etapa ou comentários não encontrados.");

            // --- Remove the comment using its original index ---
            const comentarioRemovido = etapaToUpdate.comentarios[commentIndex]; // For logging if needed
            if (!comentarioRemovido) throw new Error("Comentário no índice especificado não encontrado.");

             // Check permissions again just before deletion
            if (currentUser.perfil !== 'admin' && currentUser.nome !== comentarioRemovido.user) {
                showToast("Você não tem permissão para excluir este comentário.", "error");
                return;
            }

            etapaToUpdate.comentarios.splice(commentIndex, 1); // Remove from array

            // --- Update Firestore ---
            await updateDoc(obraRef, { pedidos: obraToUpdate.pedidos });

            showToast("Comentário excluído com sucesso.");
            logInteraction('delete_comment', { etapaId: currentInfoEtapaId, commentIndex });
            const etapaIdentifier = getEtapaLogIdentifier(pedidoToUpdate, currentInfoEtapaId);
            await logActivity(targetObra.id, `removeu um comentário na etapa ${etapaIdentifier}.`);
            // UI updates via onSnapshot

        } catch (error) {
            console.error("Erro ao excluir comentário:", error);
            showToast("Falha ao excluir comentário.", "error");
        }
    });
};

const handleEditComentario = (commentIndex) => {
    // Find the comment item in the DOM using the original index
    const commentItem = document.querySelector(`.comment-item[data-index="${commentIndex}"]`);
    if (!commentItem || commentItem.querySelector('textarea')) return; // Already in edit mode or not found

    const textP = commentItem.querySelector('.comment-text');
    const actionsDiv = commentItem.querySelector('.comment-actions');
    const originalText = textP.textContent;

    // Hide the original text and action buttons
    textP.style.display = 'none';
    if(actionsDiv) actionsDiv.style.display = 'none';

    // Create textarea and save/cancel buttons for editing
    const editContainer = document.createElement('div');
    editContainer.className = 'mt-2';
    editContainer.innerHTML = `
        <textarea class="w-full p-2 border bg-gray-600 border-gray-500 rounded-lg text-white text-sm" rows="3">${originalText}</textarea>
        <div class="flex justify-end gap-2 mt-2">
            <button class="cancel-edit-btn bg-gray-500 hover:bg-gray-400 text-white font-bold py-1 px-3 rounded-lg text-xs">Cancelar</button>
            <button class="save-edit-btn bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded-lg text-xs">Salvar</button>
        </div>
    `;
    commentItem.appendChild(editContainer); // Add editing controls to the comment item

    // --- Add Event Listeners for Edit Controls ---
    editContainer.querySelector('.cancel-edit-btn').addEventListener('click', () => {
        // Remove editing controls and restore original view
        editContainer.remove();
        textP.style.display = 'block';
        if(actionsDiv) actionsDiv.style.display = 'flex';
    });

    editContainer.querySelector('.save-edit-btn').addEventListener('click', async () => {
        const newText = editContainer.querySelector('textarea').value.trim();
        // Save only if text is changed and not empty
        if (newText && newText !== originalText) {
            await saveEditedComentario(commentIndex, newText);
            // No need to manually update UI here, onSnapshot will handle it
        } else {
            // If text is unchanged or empty, just cancel the edit
            editContainer.remove();
            textP.style.display = 'block';
            if(actionsDiv) actionsDiv.style.display = 'flex';
        }
    });
};

const saveEditedComentario = async (commentIndex, newText) => {
    const [targetObra, targetPedido, ] = findEtapaParents(currentInfoEtapaId);
    if (!targetObra || !targetPedido) {
        showToast("Erro ao salvar: Obra ou Pedido não encontrado.", "error");
        return;
    }

    try {
        const obraRef = doc(obrasCollection, targetObra.id);
        // --- Fetch latest data ---
        const obraSnap = await getDoc(obraRef);
        if (!obraSnap.exists()) throw new Error("Obra não encontrada para editar comentário.");

        const obraToUpdate = obraSnap.data();
        const pedidoToUpdate = obraToUpdate.pedidos.find(p => p.id === targetPedido.id);
         if (!pedidoToUpdate) throw new Error("Pedido não encontrado.");
        const etapaToUpdate = pedidoToUpdate.etapas.find(e => e.id === currentInfoEtapaId);
         if (!etapaToUpdate || !etapaToUpdate.comentarios) throw new Error("Etapa ou comentários não encontrados.");

        const comentarioToUpdate = etapaToUpdate.comentarios[commentIndex];
        if (!comentarioToUpdate) throw new Error("Comentário no índice não encontrado.");

         // --- Permission Check ---
        if (currentUser.perfil !== 'admin' && currentUser.nome !== comentarioToUpdate.user) {
            showToast("Você não tem permissão para editar este comentário.", "error");
            // Find the edit container and trigger cancel (to restore UI)
             const commentItem = document.querySelector(`.comment-item[data-index="${commentIndex}"]`);
             const editContainer = commentItem?.querySelector('textarea')?.closest('div');
             editContainer?.querySelector('.cancel-edit-btn')?.click();
            return;
        }

        // --- Update comment data ---
        comentarioToUpdate.texto = newText;
        comentarioToUpdate.editadoEm = new Date(); // Add/update edited timestamp

        // --- Save to Firestore ---
        await updateDoc(obraRef, { pedidos: obraToUpdate.pedidos });

        showToast("Comentário atualizado com sucesso.");
        logInteraction('edit_comment', { etapaId: currentInfoEtapaId, commentIndex });
        const etapaIdentifier = getEtapaLogIdentifier(pedidoToUpdate, currentInfoEtapaId);
        await logActivity(targetObra.id, `editou um comentário na etapa ${etapaIdentifier}.`);
        // UI updates via onSnapshot

    } catch (error) {
        console.error("Erro ao salvar edição do comentário:", error);
        showToast("Falha ao salvar edição.", "error");
         // Attempt to restore UI if save failed
         const commentItem = document.querySelector(`.comment-item[data-index="${commentIndex}"]`);
         const editContainer = commentItem?.querySelector('textarea')?.closest('div');
         editContainer?.querySelector('.cancel-edit-btn')?.click();
    }
};

const renderLogisticaList = (logisticaItems = []) => {
    const container = document.getElementById('logisticaContainer');
    container.innerHTML = '';
    // Show placeholder if list is empty
    if (logisticaItems.length === 0) {
         container.innerHTML = '<p class="text-xs text-gray-500 text-center py-2">Nenhum veículo adicionado.</p>';
         return;
    }
    // Render each logistics item row
    logisticaItems.forEach((item, index) => {
        const el = document.createElement('div');
        el.className = 'grid grid-cols-12 gap-2 items-center';
        el.innerHTML = `
            <input type="text" value="${item.carro || ''}" placeholder="Carro" class="logistica-carro col-span-4 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <input type="text" value="${item.motorista || ''}" placeholder="Motorista" class="logistica-motorista col-span-4 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <input type="datetime-local" value="${item.saida || ''}" class="logistica-saida col-span-3 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <button type="button" class="remove-logistica-btn action-btn text-red-500 hover:text-red-400"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd" /></svg></button>
        `;
        container.appendChild(el);
    });
}
const renderProcedimentos = (procedimentosData) => {
    const container = document.getElementById('procedimentosContainer');
    container.innerHTML = '';
    // Determine if fields should be read-only based on user profile
    const isReadOnly = currentUser.perfil === 'Normal' || currentUser.perfil === 'Visualizacao';

    // Render dropdown for each procedure defined in PROCEDIMENTOS_LIST
    PROCEDIMENTOS_LIST.forEach(proc => {
        const status = procedimentosData[proc.key] || 'Pendente'; // Default to 'Pendente'
        const el = document.createElement('div');
        el.className = 'flex items-center justify-between';
        el.innerHTML = `
            <label class="text-sm text-gray-300">${proc.label}</label>
            <select data-key="${proc.key}" class="procedimento-status bg-gray-700 border border-gray-600 text-white text-xs rounded-md p-1" ${isReadOnly ? 'disabled' : ''}>
                <option value="Pendente" ${status === 'Pendente' ? 'selected' : ''}>Pendente</option>
                <option value="OK" ${status === 'OK' ? 'selected' : ''}>OK</option>
                <option value="Cobrado" ${status === 'Cobrado' ? 'selected' : ''}>Cobrado</option>
                <option value="N/A" ${status === 'N/A' ? 'selected' : ''}>N/A</option> // Added N/A option
            </select>
        `;
        container.appendChild(el);
    });
};
const renderHotelLists = (alocadosIds = [], hotelaria = {}) => {
    // Destroy previous Sortable instances for hotel lists
    activeHotelSortables.forEach(s => s.destroy());
    activeHotelSortables = [];

    // Get IDs currently assigned to each room type
    const idLists = {
        individual: hotelaria.individual || [],
        duplo: hotelaria.duplo || [],
        triplo: hotelaria.triplo || []
    };

    // --- Determine Employees Still to be Allocated to Rooms ---
    const groupedAlocados = {}; // Grouped by company
    let aAlocarCount = 0;
    alocadosIds.forEach(funcId => {
        // Check if employee is NOT in any room list
        if (!idLists.individual.includes(funcId) && !idLists.duplo.includes(funcId) && !idLists.triplo.includes(funcId)) {
            aAlocarCount++;
            const func = funcionarios.find(f => f.id === funcId);
            if (func) {
                // Group by company for display
                const empresaId = func.empresa_id || 'sem_empresa';
                if (!groupedAlocados[empresaId]) groupedAlocados[empresaId] = [];
                groupedAlocados[empresaId].push(func);
            }
        }
    });

    const alocadosContainer = document.getElementById('hotelAlocadosList');
    alocadosContainer.innerHTML = ''; // Clear previous content

    // Sort company groups alphabetically
    const sortedEmpresaIds = Object.keys(groupedAlocados).sort((a, b) => {
        const nomeA = (empresas.find(e => e.id === a) || { nome: 'Sem Empresa' }).nome;
        const nomeB = (empresas.find(e => e.id === b) || { nome: 'Sem Empresa' }).nome;
        return nomeA.localeCompare(nomeB);
    });

    // Render each company group in the 'to be allocated' list
    sortedEmpresaIds.forEach(empresaId => {
         const empresaNome = (empresas.find(e => e.id === empresaId) || {nome: 'Sem Empresa'}).nome;
         const groupContainer = document.createElement('div');
         groupContainer.className = 'empresa-group !p-1 !mb-2'; // Compact group style
         const listEl = document.createElement('div');
         listEl.className = 'space-y-1 min-h-[5px] hotel-empresa-list'; // List within group
         groupContainer.innerHTML = `<h4 class="font-semibold text-blue-400 mb-1 text-xs px-1">${empresaNome}</h4>`;
         // Sort employees within group and create mini cards
         groupedAlocados[empresaId].sort((a,b) => a.nome.localeCompare(b.nome)).forEach(func => listEl.appendChild(createMiniColaboradorCard(func)));
         groupContainer.appendChild(listEl);
         alocadosContainer.appendChild(groupContainer);
         // Make the list within the group sortable
         activeHotelSortables.push(new Sortable(listEl, { group: 'hotel', animation: 150, onEnd: renderHotelListsFromDOM }));
    });
    // Make the main 'to be allocated' container a sortable target as well
    activeHotelSortables.push(new Sortable(alocadosContainer, { group: 'hotel', animation: 150, onAdd: renderHotelListsFromDOM }));

    // --- Render Room Lists ---
    const renderRoomList = (listId, funcIds) => {
        const container = document.getElementById(listId);
        container.innerHTML = ''; // Clear previous content
        // Add mini cards for each employee in the room list
        funcIds.forEach(funcId => {
            const func = funcionarios.find(f => f.id === funcId);
            if (func) container.appendChild(createMiniColaboradorCard(func));
        });
        // Add visual cue if the dropzone is empty
        container.classList.toggle('dropzone-empty', container.children.length === 0);
        // Make the room list sortable
        activeHotelSortables.push(new Sortable(container, { group: 'hotel', animation: 150, onEnd: renderHotelListsFromDOM }));
    };

    renderRoomList('hotelIndividualList', idLists.individual);
    renderRoomList('hotelDuploList', idLists.duplo);
    renderRoomList('hotelTriploList', idLists.triplo);

    // --- Update Stats Display ---
    const statsEl = document.getElementById('hotelStats');
    const numInd = idLists.individual.length;
    // Calculate estimated number of rooms needed for double/triple
    const numDup = Math.ceil(idLists.duplo.length / 2);
    const numTri = Math.ceil(idLists.triplo.length / 3);
    statsEl.innerHTML = `
        <span>A alocar: <strong class="text-white">${aAlocarCount}</strong></span> |
        <span>Total quartos: <strong class="text-white">${numInd + numDup + numTri}</strong></span>
        (I: <strong class="text-white">${numInd}</strong>, D: <strong class="text-white">${numDup}</strong>, T: <strong class="text-white">${numTri}</strong>)
    `;
};
const renderHotelListsFromDOM = () => {
     // Helper function to re-render hotel lists based on the current state of the DOM
     // Called after a drag-and-drop operation ends
     const getIds = (elementId) => Array.from(document.querySelectorAll(`#${elementId} .colaborador-card`)).map(c => c.dataset.id);
     // Read the employee IDs from each list in the DOM
     const hotelaria = {
        individual: getIds('hotelIndividualList'),
        duplo: getIds('hotelDuploList'),
        triplo: getIds('hotelTriploList'),
     };
     const etapaId = document.getElementById('infoEtapaId').value;
     const [,,etapa] = findEtapaParents(etapaId);
     if (etapa) {
        // Re-render using the IDs read from DOM and the original list of alocados
        renderHotelLists(etapa.colaboradores_alocados || [], hotelaria);
     }
}
const saveInfoEtapa = async () => {
     if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }

     const etapaId = document.getElementById('infoEtapaId').value;
     const [targetObra, targetPedido, targetEtapa] = findEtapaParents(etapaId);

    if (!targetEtapa) { console.error("Não foi possível salvar, etapa não encontrada"); return; }

    // --- Gather data from form fields ---
    const infoData = {
        clienteTelefone: document.getElementById('infoClienteTelefone').value,
        clienteEmail: document.getElementById('infoClienteEmail').value,
        encarregado: document.getElementById('infoEncarregado').value,
        descricao: document.getElementById('infoDescricao').value,
        // Read logistics data
        logistica: Array.from(document.querySelectorAll('#logisticaContainer > div')).map(el => ({
            carro: el.querySelector('.logistica-carro').value,
            motorista: el.querySelector('.logistica-motorista').value,
            saida: el.querySelector('.logistica-saida').value,
        })).filter(item => item.carro || item.motorista || item.saida), // Filter out empty rows
        // Read hotel allocation data from DOM
        hotelaria: {
            individual: Array.from(document.getElementById('hotelIndividualList').querySelectorAll('.colaborador-card')).map(c => c.dataset.id),
            duplo: Array.from(document.getElementById('hotelDuploList').querySelectorAll('.colaborador-card')).map(c => c.dataset.id),
            triplo: Array.from(document.getElementById('hotelTriploList').querySelectorAll('.colaborador-card')).map(c => c.dataset.id),
        }
    };

    // --- Read procedure data only if user has permission ---
    if (currentUser.perfil === 'admin' || currentUser.perfil === 'RH') {
        const procedimentos = {};
        document.querySelectorAll('.procedimento-status').forEach(select => {
            procedimentos[select.dataset.key] = select.value;
        });
        procedimentos.responsavel = document.getElementById('infoResponsavelNome').value;
        infoData.procedimentos = procedimentos;
    } else {
        // If user doesn't have permission, ensure existing procedures are preserved
        infoData.procedimentos = targetEtapa.procedimentos || {};
    }

    // --- Prepare update data ---
    const obraToUpdate = obras.find(o => o.id === targetObra.id);
    const updatedPedidos = JSON.parse(JSON.stringify(obraToUpdate.pedidos)); // Deep copy
    const pedidoToUpdate = updatedPedidos.find(p => p.id === targetPedido.id);
    const etapaToUpdate = (pedidoToUpdate.etapas || []).find(e => e.id === etapaId);

    // Merge new data into the etapa object
    Object.assign(etapaToUpdate, infoData);

    try {
        // --- Save to Firestore ---
        const obraRef = doc(obrasCollection, obraToUpdate.id);
        await updateDoc(obraRef, { pedidos: updatedPedidos });
        logInteraction('save_info_etapa', { etapaId, data: infoData });
        const etapaIdentifier = getEtapaLogIdentifier(pedidoToUpdate, etapaToUpdate.id);
        await logActivity(targetObra.id, `atualizou as informações da etapa ${etapaIdentifier} do pedido "${targetPedido.numero}".`);

        closeModal(document.getElementById('infoEtapaModal'));
        showToast(`Informações da etapa "${etapaToUpdate.nome}" salvas.`);
    } catch(error) {
        console.error("Erro ao salvar informações da etapa: ", error);
        logInteraction('error_save_info_etapa', { error });
        showToast("Falha ao salvar informações.", "error");
    }
}
const openEmpresaModal = (empresa = {}) => {
    const form = document.getElementById('empresaForm');
    form.reset();
    document.getElementById('empresaId').value = empresa.id || '';
    document.getElementById('empresaModalTitle').textContent = empresa.id ? `Editar Empresa: ${empresa.nome}` : 'Nova Empresa';
    document.getElementById('empresaNome').value = empresa.nome || '';
    document.getElementById('empresaTipo').value = empresa.tipo || 'Terceirizada'; // Default to Terceirizada
    openModal(document.getElementById('empresaModal'));
};
const openFuncionarioModal = (func = {}) => {
    const form = document.getElementById('funcionarioForm');
    form.reset();
    document.getElementById('funcionarioId').value = func.id || '';
    // Pre-select the company if adding from the context of a selected company
    document.getElementById('funcionarioEmpresaId').value = func.empresa_id || selectedEmpresaId;
    document.getElementById('funcionarioModalTitle').textContent = func.id ? `Editar Funcionário: ${func.nome}` : 'Novo Funcionário';
    document.getElementById('funcionarioNome').value = func.nome || '';
    document.getElementById('funcionarioCargo').value = func.cargo || '';
    // Populate integration fields
    document.getElementById('funcionarioIntegracaoBRF').value = func.integracaoBRF || '';
    document.getElementById('funcionarioIntegracaoJBS').value = func.integracaoJBS || '';
    openModal(document.getElementById('funcionarioModal'));
};
const updateObraLabelBtn = () => {
    // Update the text on the label toggle buttons based on the current `obraLabelType`
    const text = obraLabelType === 'numero' ? 'Nº Projeto' : 'Nome Projeto';
    const btn1 = document.getElementById('toggleObraLabelBtn');
    if(btn1) btn1.textContent = text;
    const btn2 = document.getElementById('toggleColaboradorLabelBtn');
    if(btn2) btn2.textContent = text;
};

const generateEtapaReport = (etapaId) => {
    // Find the initial etapa and its context
    const [parentObra, parentPedido, initialEtapa] = findEtapaParents(etapaId);
    if (!initialEtapa) { showToast('Erro ao gerar relatório: Etapa não encontrada.', 'error'); return; }

    // Get all etapas belonging to the same group (same name)
    const etapasDoGrupo = (parentPedido.etapas || []).filter(e => e.nome === initialEtapa.nome).sort((a,b) => new Date(a.data_inicio) - new Date(b.data_inicio));

    const wb = XLSX.utils.book_new(); // Create a new workbook
    const reportData = []; // Array to hold all rows of data

    // --- Header ---
    reportData.push([`RELATÓRIO DE ETAPA AGRUPADA: ${initialEtapa.nome}`]);
    reportData.push([]); // Empty row for spacing
    reportData.push(["Projeto:", parentObra.nome, "", "Número:", parentObra.numero]);
    reportData.push(["Cliente:", parentObra.cliente, "", "Pedido:", parentPedido.numero]);
    reportData.push([]); // Empty row

    // --- Iterate through each task in the group ---
    etapasDoGrupo.forEach((etapa, index) => {
        reportData.push([`--- TAREFA ${index + 1} de ${etapasDoGrupo.length} ---`]);
        reportData.push(["Período:", `${etapa.data_inicio || 'N/A'} a ${etapa.data_fim || 'N/A'}`]);
        reportData.push(["DESCRIÇÃO DO SERVIÇO"]);
        reportData.push([etapa.descricao || 'Nenhuma descrição fornecida.']);
        reportData.push([]);

        reportData.push(["INFORMAÇÕES ADICIONAIS"]);
        reportData.push(["Encarregado da Obra:", etapa.encarregado || 'N/A']);
        reportData.push(["Telefone Cliente:", etapa.clienteTelefone || 'N/A']);
        reportData.push(["Email Cliente:", etapa.clienteEmail || 'N/A']);
        reportData.push(["Responsável Procedimentos:", etapa.procedimentos?.responsavel || 'N/A']);
        reportData.push([]);

        // --- Alocados Section ---
        const alocadosIds = etapa.colaboradores_alocados || [];
        reportData.push([`COLABORADORES ALOCADOS (${alocadosIds.length})`]);
        if (alocadosIds.length > 0) {
            reportData.push(["Nome", "Cargo", "Empresa", "Status de Conflito"]); // Headers
            alocadosIds.forEach(funcId => {
                const func = funcionarios.find(f => f.id === funcId);
                const emp = func ? empresas.find(e => e.id === func.empresa_id) : null;
                // Check for conflicts related to this specific etapa and employee
                const etapaConflicts = conflictMap.get(etapa.id);
                let conflictStatus = "Sem conflito";
                if (etapaConflicts && etapaConflicts.has(funcId)) {
                    conflictStatus = etapaConflicts.get(funcId); // Get conflict message
                }
                reportData.push([
                    func?.nome || 'Desconhecido',
                    func?.cargo || 'N/A',
                    emp?.nome || 'N/A',
                    conflictStatus
                ]);
            });
        } else {
            reportData.push(["Nenhum colaborador alocado."]);
        }
        reportData.push([]); // Empty row
        reportData.push([]); // Extra empty row between tasks
    });

    const ws = XLSX.utils.aoa_to_sheet(reportData); // Convert array of arrays to worksheet

    // --- Auto-adjust Column Widths (basic approach) ---
    const columnWidths = reportData.reduce((widths, row) => {
        (row || []).forEach((cell, i) => {
            const cellValue = cell ? String(cell) : '';
            const len = cellValue.length;
            if (!widths[i] || len > widths[i]) {
                widths[i] = len; // Track max length for each column
            }
        });
        return widths;
    }, []);
    // Apply widths with padding and max width limit
    ws['!cols'] = columnWidths.map(width => ({ wch: Math.min(Math.max(width, 10) + 2, 80) }));

    XLSX.utils.book_append_sheet(wb, ws, "Relatório da Etapa"); // Add worksheet to workbook
    // Generate and trigger download
    XLSX.writeFile(wb, `Relatorio_Etapa_${initialEtapa.nome.replace(/\s/g, '_')}.xlsx`);
    showToast('Relatório da etapa gerado com sucesso!');
};

const generateObraReport = (obraId) => {
    const obra = obras.find(o => o.id === obraId);
    if (!obra) { showToast('Erro: Projeto não encontrado.', 'error'); return; }

    const wb = XLSX.utils.book_new();
    const reportData = [];

    // --- Calculate Summary Stats ---
    const todasEtapas = (obra.pedidos || []).flatMap(p => p.etapas || []);
    const allColabIds = new Set(todasEtapas.flatMap(e => e.colaboradores_alocados || [])); // Unique collaborators
    const hasConflicts = todasEtapas.some(e => conflictMap.has(e.id)); // Any conflicts in the project?
    let totalQuartos = 0;
    todasEtapas.forEach(e => { // Calculate total estimated rooms
        totalQuartos += (e.hotelaria?.individual?.length || 0);
        totalQuartos += Math.ceil((e.hotelaria?.duplo?.length || 0) / 2);
        totalQuartos += Math.ceil((e.hotelaria?.triplo?.length || 0) / 3);
    });

    // --- Header and Summary ---
    reportData.push(["RELATÓRIO GERAL DO PROJETO"]);
    reportData.push([]);
    reportData.push(["Projeto:", obra.nome]);
    reportData.push(["Número:", obra.numero]);
    reportData.push(["Cliente:", obra.cliente]);
    reportData.push([]);
    reportData.push(["SUMÁRIO GERAL"]);
    reportData.push(["Total de Colaboradores Únicos:", allColabIds.size]);
    reportData.push(["Total de Quartos Estimados:", totalQuartos]);
    reportData.push(["Status de Conflitos:", hasConflicts ? "CONFLITOS DETECTADOS" : "Sem conflitos"]);
    reportData.push([]);

    // --- Detailed Schedule and Allocation ---
    reportData.push(["CRONOGRAMA DETALHADO E ALOCAÇÕES"]);
    reportData.push(["Pedido", "Etapa", "Início", "Fim", "Nome do Colaborador", "Função", "Empresa"]); // Headers

    // Iterate through sorted pedidos and etapas
    (obra.pedidos || []).sort((a,b) => (a.numero || '').localeCompare(b.numero || '', undefined, {numeric: true})).forEach(p => {
        (p.etapas || []).sort((a,b) => new Date(a.data_inicio) - new Date(b.data_inicio)).forEach(e => {
            const alocados = e.colaboradores_alocados || [];
            if (alocados.length > 0) {
                // Add a row for each allocated employee
                alocados.forEach(funcId => {
                    const func = funcionarios.find(f => f.id === funcId);
                    const emp = func ? empresas.find(em => em.id === func.empresa_id) : null;
                    reportData.push([ p.numero, e.nome, e.data_inicio, e.data_fim, func?.nome || 'ID não encontrado', func?.cargo || 'N/A', emp?.nome || 'N/A' ]);
                });
            } else {
                // Add a row indicating no allocation if empty
                reportData.push([p.numero, e.nome, e.data_inicio, e.data_fim, "(Nenhum colaborador alocado)", "", ""]);
            }
        });
    });

    const ws = XLSX.utils.aoa_to_sheet(reportData);

    // --- Auto-adjust Column Widths ---
    const columnWidths = reportData.reduce((widths, row) => {
        (row || []).forEach((cell, i) => {
            const cellValue = cell ? String(cell) : '';
            const len = cellValue.length;
            if (!widths[i] || len > widths[i]) {
                widths[i] = len;
            }
        });
        return widths;
    }, []);
    ws['!cols'] = columnWidths.map(width => ({ wch: Math.min(Math.max(width, 10) + 2, 80) }));

    XLSX.utils.book_append_sheet(wb, ws, "Relatório do Projeto");
    XLSX.writeFile(wb, `Relatorio_Projeto_${obra.nome.replace(/\s/g, '_')}.xlsx`);
    showToast('Relatório do projeto gerado com sucesso!');
}

const updateUIPermissions = () => {
    const perfil = currentUser?.perfil;
    if (!perfil) return; // Exit if user profile is not defined

    const isVisualizacao = perfil === 'Visualizacao';
    const isAdmin = perfil === 'admin';
    const isRH = perfil === 'RH';

    // --- Global Controls ---
    document.getElementById('settingsBtn').classList.toggle('hidden', !isAdmin); // Only admin sees settings

    // --- Buttons to Disable for Visualizacao ---
    const elementsToDisable = [
        '#addObraBtn', '#addEmpresaBtn', '#saveObraBtn', '#saveEmpresaBtn',
        '#saveFuncionarioBtn', '#saveAlocacaoBtn', '#saveInfoEtapaBtn', '#saveFechamentoBtn',
        '#deleteObraBtn', '#addPedidoBtn', '#addPendenciaBtn', '#addLogisticaBtn',
        '#confirmVisualizacaoBtn', // Although logic hides it, disable for safety
        '#userForm button[type=submit]', '#clearUserFormBtn' // User management buttons
    ];

    elementsToDisable.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) el.disabled = isVisualizacao;
    });

    // --- Buttons/Links to Hide for Visualizacao ---
     document.querySelectorAll('.edit-btn, .delete-btn, #addFuncionarioBtn, .remove-pedido-btn, .remove-etapa-btn, .copy-etapa-btn, .remove-logistica-btn, .remove-pendencia-btn, .edit-comment-btn, .delete-comment-btn, .edit-user-btn, .delete-user-btn, #copyAllocationsBtn').forEach(btn => {
        btn.style.display = isVisualizacao ? 'none' : ''; // Use '' to revert to default display
    });

    // --- Make Inputs/Textareas/Selects Readonly/Disabled for Visualizacao ---
    document.querySelectorAll('input, textarea, select').forEach(el => {
        // Exclude login form elements and search inputs
        if(!el.closest('#loginForm') && el.id !== 'globalSearchInput' && el.id !== 'alocacaoSearch' && !el.id.startsWith('integracaoFiltro')) {
            
            // v11.0: NÃO desabilita os selects de ordenação para 'Visualizacao'
            if (el.tagName === 'SELECT' && (el.id === 'obraSort' || el.id === 'colaboradorSort' || el.id === 'integracaoSort' || el.id === 'sortAlocacao')) {
                el.disabled = false;
                el.readOnly = false; // Apenas para garantir
                return; // Pula para o próximo elemento
            }
            // Fim da modificação v11.0

            el.readOnly = isVisualizacao;
            // Select elements need to be disabled, not just readonly
            if(el.tagName === 'SELECT') el.disabled = isVisualizacao;
            // Also disable checkboxes used as filters in 'Alocacao' and 'Integracoes'
            if(el.type === 'checkbox' && (el.id.startsWith('filtro') || el.id.startsWith('integracaoFiltro'))) {
                 // Keep filters enabled for Visualizacao
                 el.disabled = false; // Override disable for filters
                 el.readOnly = false;
            } else if (el.type === 'checkbox') {
                 el.disabled = isVisualizacao;
            }
        }
    });

    // Ensure specific read-only fields remain so even for other roles
    document.getElementById('infoClienteNome').readOnly = true;

    // --- Specific Controls for RH/Normal ---
    const canEditProcedures = isAdmin || isRH;
    // Disable procedure dropdowns and responsible input if not Admin/RH
    document.querySelectorAll('.procedimento-status').forEach(sel => sel.disabled = isVisualizacao || !canEditProcedures);
    document.getElementById('infoResponsavelNome').readOnly = isVisualizacao || !canEditProcedures;

    // --- Draggability ---
    // Disable SortableJS dragging for Visualizacao profile (more complex, might need library-specific methods if just disabling isn't enough)
     if (ganttSidebarSortable) ganttSidebarSortable.option('disabled', isVisualizacao);
     activeProjectsSortables.forEach(s => s.option('disabled', isVisualizacao));
     activeAlocacaoSortables.forEach(s => s.option('disabled', isVisualizacao));
     activeHotelSortables.forEach(s => s.option('disabled', isVisualizacao));

     // Make Gantt bars non-resizable/draggable for Visualizacao
     // Handled within the mousedown listener logic by checking currentUser.perfil

     // Comment form
     const commentForm = document.getElementById('comentarioForm');
     if (commentForm) {
         commentForm.querySelector('textarea').disabled = isVisualizacao;
         commentForm.querySelector('button').disabled = isVisualizacao;
     }

};

const openFechamentoModal = (obraId) => {
    const obra = obras.find(o => o.id === obraId);
    if(!obra) return; // Exit if obra not found

    // Populate modal fields with obra data
    document.getElementById('fechamentoObraId').value = obraId;
    document.getElementById('fechamentoModalTitle').textContent = `Fechamento / Pendências: ${obra.nome}`;
    document.getElementById('fechamentoObservacoes').value = obra.observacoes || '';
    document.getElementById('obraFinalizadaCheckbox').checked = obra.finalizada || false;

    // --- Render Pendencias List ---
    const list = document.getElementById('pendenciasList');
    list.innerHTML = ''; // Clear previous items
    (obra.pendencias || []).forEach((p, index) => {
        const pendenciaEl = document.createElement('div');
        pendenciaEl.className = 'flex items-center justify-between bg-gray-700/50 p-2 rounded';
        pendenciaEl.innerHTML = `
            <div class="flex items-center flex-grow mr-2">
                <input id="pendencia-${index}" type="checkbox" ${p.concluida ? 'checked' : ''} class="h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 pendencia-checkbox flex-shrink-0" data-index="${index}">
                <label for="pendencia-${index}" class="ml-2 ${p.concluida ? 'line-through text-gray-500' : ''} break-words">${p.texto}</label>
            </div>
            <button class="remove-pendencia-btn action-btn text-red-500 flex-shrink-0" data-index="${index}">
                <svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd"></path></svg>
            </button>
        `;
        list.appendChild(pendenciaEl);
    });

    openModal(document.getElementById('fechamentoModal'));
};

const saveFechamento = async () => {
     if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }
     const obraId = document.getElementById('fechamentoObraId').value;
     const obra = obras.find(o => o.id === obraId);
     if (!obra) return;

     // --- Read pendencias data from the DOM ---
     const pendencias = Array.from(document.getElementById('pendenciasList').children).map((el) => {
        // Find the label safely, even if structure changes slightly
        const label = el.querySelector('label');
        const checkbox = el.querySelector('input[type=checkbox]');
        return {
            texto: label ? label.textContent : '', // Get text content of the label
            concluida: checkbox ? checkbox.checked : false // Get checked state
        }
     }).filter(p => p.texto); // Filter out any potentially empty items if needed

     // --- Gather all data to save ---
     const data = {
        pendencias: pendencias,
        observacoes: document.getElementById('fechamentoObservacoes').value,
        finalizada: document.getElementById('obraFinalizadaCheckbox').checked,
        lastUpdate: new Date() // Add timestamp for last update
     };

     try {
        // --- Update Firestore ---
        await updateDoc(doc(obrasCollection, obraId), data);
        // Log if the 'finalizada' status changed
        if (obra.finalizada !== data.finalizada) {
            await logActivity(obraId, `marcou a obra como ${data.finalizada ? 'Finalizada' : 'Não Finalizada'}.`);
        }
         // Log changes in pendencies (more complex, could compare arrays) - Skipped for brevity
         if (obra.observacoes !== data.observacoes) {
              await logActivity(obraId, `atualizou as observações de fechamento.`);
         }
        showToast("Dados de fechamento salvos com sucesso!");
        closeModal(document.getElementById('fechamentoModal'));
     } catch(e) {
        console.error("Erro ao salvar fechamento: ", e);
        showToast("Erro ao salvar dados.", 'error');
     }
};

const openActivityLogModal = (obraId) => {
    const obra = obras.find(o => o.id === obraId);
    if (!obra) return;
    document.getElementById('activityLogModalTitle').textContent = `Histórico: ${obra.nome}`;
    const container = document.getElementById('activityLogContainer');
    container.innerHTML = '<p class="text-gray-400">Carregando histórico...</p>'; // Loading state

    // Sort logs by timestamp, most recent first
    const logs = [...(obra.activityLog || [])].sort((a,b) => {
         const dateA = a.timestamp?.toDate ? a.timestamp.toDate() : (a.timestamp instanceof Date ? a.timestamp : new Date(0));
         const dateB = b.timestamp?.toDate ? b.timestamp.toDate() : (b.timestamp instanceof Date ? b.timestamp : new Date(0));
         return dateB - dateA;
    });

    // Render logs or placeholder
    if (logs.length === 0) {
        container.innerHTML = '<p class="text-gray-400">Nenhuma atividade registrada para este projeto.</p>';
    } else {
        container.innerHTML = logs.map(log => {
            const date = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString('pt-BR') : (log.timestamp instanceof Date ? log.timestamp.toLocaleString('pt-BR') : 'Data inválida');
            return `<div class="bg-gray-700/50 p-2 rounded">
                <p class="text-sm text-white"><strong class="font-semibold">${log.user}</strong> ${log.message}</p>
                <p class="text-xs text-gray-400 text-right">${date}</p>
            </div>`;
        }).join('');
    }

    openModal(document.getElementById('activityLogModal'));
};

const openSettingsModal = () => {
    if (currentUser?.perfil !== 'admin') { // Double check permission
        showToast("Acesso negado.", "error");
        return;
    }
    renderUserList(); // Populate user list
    clearUserForm(); // Reset the add/edit form
    openModal(document.getElementById('settingsModal'));
};

const renderUserList = () => {
    const container = document.getElementById('userListContainer');
    container.innerHTML = '';
    // Sort users alphabetically and render
    users.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(user => {
        const el = document.createElement('div');
        el.className = 'p-3 bg-gray-700/50 rounded flex justify-between items-center';
        el.innerHTML = `
            <div>
                <p class="font-semibold text-white">${user.nome}</p>
                <p class="text-sm text-gray-400">${user.login} - <span class="font-medium">${user.perfil}</span></p>
            </div>
             <div class="flex gap-2">
                <button class="edit-user-btn action-btn" data-id="${user.id}"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg></button>
                <button class="delete-user-btn action-btn" data-id="${user.id}"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd" /></svg></button>
            </div>
        `;
        container.appendChild(el);
    });
};

const clearUserForm = () => {
     // Reset the user form to its default state for adding a new user
     document.getElementById('userForm').reset();
     document.getElementById('userId').value = ''; // Clear hidden ID field
     document.getElementById('userSenha').required = true; // Make password required for new users
     document.getElementById('userSenha').placeholder = 'Senha (obrigatória para novo usuário)'; // Update placeholder
     document.getElementById('userFormTitle').textContent = 'Adicionar Novo Usuário'; // Reset title
};

const handleUserForm = async (e) => {
    e.preventDefault();
    if (currentUser?.perfil !== 'admin') {
        showToast("Apenas Admin pode gerenciar usuários.", "error");
        return;
    }
    const id = document.getElementById('userId').value; // Get ID (if editing)
    const senha = document.getElementById('userSenha').value;

    // Password validation for new users
    if (!id && !senha) {
        showToast("A senha é obrigatória para novos usuários.", "error");
        document.getElementById('userSenha').focus();
        return;
    }

    // Gather user data from form
    const userData = {
        nome: document.getElementById('userNome').value.trim(),
        login: document.getElementById('userLogin').value.toLowerCase().trim(), // Store login as lowercase
        perfil: document.getElementById('userPerfil').value,
    };

    if (!userData.nome || !userData.login) {
        showToast("Nome e Login são obrigatórios.", "error");
        return;
    }

    // Add password only if provided (for new users or password change)
    if (senha) {
        // !! SECURITY WARNING !!
        // Storing passwords in plain text (even in Firestore) is highly insecure.
        // This should be replaced with Firebase Authentication for production.
        // For this implementation, we'll store it as provided, but acknowledge the risk.
        console.warn("SECURITY WARNING: Storing password in plain text.");
        userData.senha = senha;
    }

    try {
        if(id) { // Update existing user
            // Ensure admin cannot accidentally remove their own admin rights
            if (id === currentUser.id && userData.perfil !== 'admin') {
                 showToast("Não é possível remover o próprio status de Administrador.", "error");
                 // Revert profile dropdown if necessary
                 document.getElementById('userPerfil').value = 'admin';
                 return;
            }
            await setDoc(doc(usersCollection, id), userData, { merge: true }); // Merge to avoid overwriting fields not in form
            showToast("Usuário atualizado com sucesso!");
        } else { // Create new user
             // Check if login already exists
            const existingUser = users.find(u => u.login === userData.login);
            if (existingUser) {
                showToast(`Erro: Login "${userData.login}" já está em uso.`, "error");
                document.getElementById('userLogin').focus();
                return;
            }
            await addDoc(usersCollection, userData);
            showToast("Usuário criado com sucesso!");
        }
        clearUserForm(); // Reset form after successful save
        // User list will update via onSnapshot
    } catch(error) {
        console.error("Erro ao salvar usuário:", error);
        showToast("Erro ao salvar usuário.", "error");
    }
};

const saveUserPreferences = async () => {
    if (!currentUser) return; // Only save if a user is logged in
    // Gather preferences from UI elements
    const prefs = {
        zoomLevel: zoomLevel,
        obraSort: document.getElementById('obraSort').value,
        colaboradorSort: document.getElementById('colaboradorSort').value,
        obraLabelType: obraLabelType,
        expandedState: ganttExpandedState // Save the current expanded/collapsed state of Gantt items
    };
    try {
        // Save preferences to Firestore under the current user's ID
        await setDoc(doc(userPreferencesCollection, currentUser.id), prefs);
        logInteraction('save_preferences', prefs);
    } catch (error) {
        console.error("Erro ao salvar preferências:", error);
        // Optionally notify user of failure
        // showToast("Falha ao salvar preferências.", "error");
    }
};

const loadUserPreferences = async () => {
     if (!currentUser) return; // Only load if a user is logged in
     try {
        const docRef = doc(userPreferencesCollection, currentUser.id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const prefs = docSnap.data();
            // Apply loaded preferences, using defaults if a preference is missing
            zoomLevel = prefs.zoomLevel ?? zoomLevel;
            document.getElementById('obraSort').value = prefs.obraSort || 'proximas';
            document.getElementById('colaboradorSort').value = prefs.colaboradorSort || 'proximas';
            obraLabelType = prefs.obraLabelType || 'numero';
            ganttExpandedState = prefs.expandedState || {};
            updateObraLabelBtn(); // Update button text based on loaded label type
            logInteraction('load_preferences', prefs);
        } else {
             logInteraction('load_preferences', { status: 'No preferences found, using defaults.' });
             // No preferences saved yet, use defaults (already set)
        }
     } catch (error) {
         console.error("Erro ao carregar preferências:", error);
         // Optionally notify user
         // showToast("Falha ao carregar suas preferências.", "error");
     }
};

const initialize = async () => {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    // [INÍCIO DA ADIÇÃO] - Lógica de Detecção do Emulador
    // Check if running on localhost (emulator environment)
    const isEmulator = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isEmulator) {
        try {
            console.log("Modo Emulador Detectado. Conectando aos emuladores...");
            // Connect to default emulator ports
            // Firestore: 8080
            // Auth: 9099
            connectFirestoreEmulator(db, 'localhost', 8080);
            connectAuthEmulator(auth, 'http://localhost:9099');
            console.log("Conectado com sucesso aos Emuladores Firebase (Auth e Firestore).");
        } catch (e) {
            console.error("Falha ao conectar aos emuladores. Verifique se eles estão em execução.", e);
        }
    } else {
        console.log("Modo Produção. Conectando ao Firebase real.");
    }
    // [FIM DA ADIÇÃO]

    // --- Define Firestore Collection References ---
    // Using public data path structure
    obrasCollection = collection(db, `/artifacts/${appId}/public/data/obras`);
    funcionariosCollection = collection(db, `/artifacts/${appId}/public/data/funcionarios`);
    empresasCollection = collection(db, `/artifacts/${appId}/public/data/empresas`);
    settingsCollection = collection(db, `/artifacts/${appId}/public/data/settings`);
    usersCollection = collection(db, `/artifacts/${appId}/public/data/users`);
    userPreferencesCollection = collection(db, `/artifacts/${appId}/public/data/userPreferences`);
    notificacoesCollection = collection(db, `/artifacts/${appId}/public/data/notificacoes`);

    try {
        // Sign in anonymously initially. The login form handles actual user authentication.
        await signInAnonymously(auth);
        console.log("Signed in anonymously");
    } catch (error) {
        console.error("Anonymous sign-in failed", error);
        // Handle failure (e.g., show error message)
    }

     // --- Initial listener for users (needed for login) ---
    onSnapshot(query(usersCollection), snap => {
         users = snap.docs.map(d => ({id: d.id, ...d.data()}));
         // If settings modal is open, refresh the user list
         if (document.getElementById('settingsModal') && !document.getElementById('settingsModal').classList.contains('hidden')) {
            renderUserList();
         }
    }, error => {
        console.error("Error fetching users collection: ", error);
        // Handle error (e.g., show message to user)
    });

    // Hide loader and show login modal after basic setup
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    const loginModal = document.getElementById('loginModal');
    if (loginModal) openModal(loginModal);
};

// ... Continuação da Parte 2, que terminou com:
//     const loginModal = document.getElementById('loginModal');
//     if (loginModal) openModal(loginModal);
// };

const startApp = async () => {
    // Load user preferences first
    await loadUserPreferences();

    // Load manual obra order
    try {
        const orderDoc = await getDoc(doc(settingsCollection, 'obraOrder'));
        if (orderDoc.exists()) {
            obraOrder = orderDoc.data().order || []; // Ensure it's an array
        }
    } catch (error) {
        console.error("Erro ao carregar ordem manual das obras:", error);
    }


    // Load active project IDs
    try {
        const activeProjectsDoc = await getDoc(doc(settingsCollection, 'activeProjects'));
        if (activeProjectsDoc.exists()) {
            activeProjectIds = activeProjectsDoc.data().ids || []; // Ensure it's an array
        }
    } catch (error) {
        console.error("Erro ao carregar projetos ativos:", error);
    }


    // --- Setup Firestore Listeners (onSnapshot) ---

    // Listener for Obras
    onSnapshot(query(obrasCollection), s => {
        obras = s.docs.map(d => ({ id: d.id, ...d.data() })); // Update global obras array

        // If no active projects are set, default to showing all projects (unless search is active)
        if (activeProjectIds.length === 0 && obras.length > 0 && !(document.getElementById('globalSearchInput') && document.getElementById('globalSearchInput').value)) {
            activeProjectIds = obras.map(o => o.id);
            // Save this default setting
            setDoc(doc(settingsCollection, 'activeProjects'), { ids: activeProjectIds })
                .catch(err => console.error("Erro ao salvar activeProjects padrão:", err));
        }

        calculateAllConflicts(); // Recalculate conflicts whenever obra data changes
        handleGlobalSearch(); // Re-apply search filter (which also triggers renderGanttChart if needed)
        if(currentTab === 'Dashboard') renderDashboard(); // Update dashboard if it's the current view

        // Refresh Info Etapa modal content if it's open and viewing an etapa from the updated data
        if (!document.getElementById('infoEtapaModal').classList.contains('hidden') && currentInfoEtapaId) {
            refreshInfoEtapaModalContent();
        }
    }, error => {
        console.error("Erro ao buscar coleção de obras:", error);
        showToast("Falha ao carregar dados das obras.", "error");
    });

    // Listener for Empresas
    onSnapshot(query(empresasCollection), s => {
        empresas = s.docs.map(d => ({ id: d.id, ...d.data() }));
        // Re-render relevant UI parts if the current tab requires empresa data
        if(currentTab === 'Gerenciamento') renderEmpresaList();
        if(currentTab === 'Integracoes') renderIntegracoesView(); // Added for new tab
        if(!document.getElementById('alocacaoModal').classList.contains('hidden')) renderAlocacaoLists(true); // Refresh alocacao if open
    }, error => {
        console.error("Erro ao buscar coleção de empresas:", error);
        showToast("Falha ao carregar dados das empresas.", "error");
    });

    // Listener for Funcionarios
    onSnapshot(query(funcionariosCollection), s => {
        funcionarios = s.docs.map(d => ({ id: d.id, ...d.data() }));
        calculateAllConflicts(); // Recalculate conflicts when employee data changes
        // Re-render relevant UI parts
        if (currentTab === 'Gerenciamento' && selectedEmpresaId) renderFuncionarioList();
        if (currentTab === 'Colaboradores') renderColaboradorView();
        // Avoid re-rendering Gantt unnecessarily if search is active (handleGlobalSearch does it)
        if (currentTab === 'Gantt' && !(document.getElementById('globalSearchInput') && document.getElementById('globalSearchInput').value)) {
             renderGanttChart();
        }
        if (currentTab === 'Dashboard') renderDashboard();
        if (currentTab === 'Integracoes') renderIntegracoesView(); // Added for new tab
        // Refresh alocacao modal if open
        if (!document.getElementById('alocacaoModal').classList.contains('hidden') && currentAlocacaoEtapaId) {
             renderAlocacaoLists(true);
        }
        // Refresh info modal if open (hotel lists depend on funcionario data)
         if (!document.getElementById('infoEtapaModal').classList.contains('hidden') && currentInfoEtapaId) {
             refreshInfoEtapaModalContent();
        }
    }, error => {
         console.error("Erro ao buscar coleção de funcionários:", error);
         showToast("Falha ao carregar dados dos funcionários.", "error");
    });

    // --- Setup Notifications Listener ---
    if (unsubscribeNotifications) unsubscribeNotifications(); // Unsubscribe from previous listener if exists

    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3); // Query for notifications from the last 3 days

    // Query sorted by timestamp descending, limited to 50
    const q = query(
        notificacoesCollection,
        where("timestamp", ">=", threeDaysAgo),
        orderBy("timestamp", "desc"),
        limit(50)
    );

    unsubscribeNotifications = onSnapshot(q, (querySnapshot) => {
        notificacoes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderNotifications(); // Update the notification UI
    }, (error) => {
        console.error("Erro ao buscar notificações. Verifique se o índice do Firestore foi criado:", error);
        // Provide guidance if it's likely an index issue (common Firestore error)
        if (error.code === 'failed-precondition') {
             showToast("Falha ao carregar notificações: Índice do Firestore ausente ou sendo criado. Tente recarregar a página em alguns minutos.", "error");
        } else {
            showToast("Falha ao carregar notificações. Verifique o console para detalhes.", "error");
        }
    });

    // --- Finalize App Startup ---
    closeModal(document.getElementById('loginModal')); // Close login modal
    const appContainer = document.getElementById('app-container');
    if (appContainer) appContainer.classList.remove('hidden'); // Show main app container
    updateUIPermissions(); // Apply UI restrictions based on user profile
    // Initial render based on the default tab (usually Gantt)
    switchTab(currentTab); // Ensure the correct tab content is displayed initially
};

const setupEventListeners = () => {
    // --- Global Buttons ---
    document.getElementById('addObraBtn').addEventListener('click', () => openObraModal());
    document.getElementById('addEmpresaBtn').addEventListener('click', () => openEmpresaModal());
    document.getElementById('addFuncionarioBtn').addEventListener('click', () => openFuncionarioModal());
    document.getElementById('goToTodayBtn').addEventListener('click', () => {
        // Scroll the appropriate Gantt view to today
        if (currentTab === 'Gantt') {
            const timeline = document.querySelector('#ganttChartContainer .gantt-timeline');
            const startDate = new Date(new Date().getFullYear(), 0, 1); // Assuming start date is Jan 1st of current year
            if(timeline && startDate) scrollToToday(timeline, startDate);
        } else if (currentTab === 'Colaboradores') {
            const timeline = document.querySelector('#colaboradorGanttContainer .gantt-timeline');
             const startDate = new Date(new Date().getFullYear(), 0, 1);
            if(timeline && startDate) scrollToToday(timeline, startDate);
        }
        // No action needed for other tabs
    });

    // --- Tab Navigation ---
    document.querySelectorAll('.tab-button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    // --- Modal Cancel Buttons ---
    document.querySelectorAll('.btn-cancel').forEach(b => {
        const modal = b.closest('.modal');
        if (modal) {
             b.addEventListener('click', (e) => {
                 if (modal.id === 'infoEtapaModal') { currentInfoEtapaId = null; } // Reset current ID when closing info modal
                 if (modal.id === 'alocacaoModal') { currentAlocacaoEtapaId = null; } // Reset current ID when closing alocacao modal
                 closeModal(modal, true, 'Ação cancelada.'); // Close with confirmation message
             });
        }
    });

     // Specific cancel button for activity log modal (doesn't need confirmation message)
    const activityLogModal = document.getElementById('activityLogModal');
    if (activityLogModal) {
        const cancelBtn = activityLogModal.querySelector('.btn-cancel-log');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => closeModal(activityLogModal));
        }
    }


    // --- Form Submissions / Saves ---
    document.getElementById('empresaForm').addEventListener('submit', handleEmpresaForm);
    document.getElementById('funcionarioForm').addEventListener('submit', handleFuncionarioForm);
    document.getElementById('comentarioForm').addEventListener('submit', handleComentarioForm);
    document.getElementById('saveObraBtn').addEventListener('click', handleObraForm); // Triggered by button click, not form submit
    document.getElementById('saveAlocacaoBtn').addEventListener('click', saveAlocacao);
    document.getElementById('saveInfoEtapaBtn').addEventListener('click', saveInfoEtapa);
    document.getElementById('saveFechamentoBtn').addEventListener('click', saveFechamento);
    document.getElementById('userForm').addEventListener('submit', handleUserForm);

    // --- Obra Modal: Pedido/Etapa Management ---
    const pedidosContainer = document.getElementById('pedidosContainer');
    if (pedidosContainer) {
        pedidosContainer.addEventListener('click', e => {
            updateTempPedidosFromForm(); // Read current form state into temp array first
            let changed = false; // Flag to check if re-rendering is needed
            const todayStr = new Date().toISOString().split('T')[0]; // Default date for new etapas

            const pedidoEl = e.target.closest('.pedido-form-item');
            if (!pedidoEl) return; // Ignore clicks outside pedido items
            const pedidoId = pedidoEl.dataset.id;
            const pedidoIndex = tempPedidos.findIndex(p => p.id === pedidoId); // Find index for modification/removal
            if (pedidoIndex === -1) return; // Pedido not found in temp data

            const pedido = tempPedidos[pedidoIndex];

            // --- Handle Button Clicks ---
            if (e.target.closest('.remove-pedido-btn')) {
                // Remove the pedido from the temporary array
                tempPedidos.splice(pedidoIndex, 1);
                changed = true;
            } else if (e.target.closest('.add-etapa-btn')) {
                // Add a new etapa to the current pedido
                const newEtapa = {
                    id: `new_${Date.now()}${Math.random()}`, // Generate unique temporary ID
                    nome: '', data_inicio: todayStr, data_fim: todayStr,
                    colaboradores_alocados: [], colaboradores_reserva: [],
                    visualizacaoRH: false // Default new field
                };
                if (!pedido.etapas) pedido.etapas = []; // Initialize etapas array if needed
                pedido.etapas.push(newEtapa);
                changed = true;
            } else if (e.target.closest('.copy-etapa-btn')) {
                // Duplicate an existing etapa
                const etapaEl = e.target.closest('.etapa-item');
                const originalEtapaId = etapaEl.dataset.id;
                const originalEtapaIndex = (pedido.etapas || []).findIndex(et => et.id === originalEtapaId);

                if (originalEtapaIndex !== -1) {
                    const originalEtapa = pedido.etapas[originalEtapaIndex];
                    const newEtapa = JSON.parse(JSON.stringify(originalEtapa)); // Deep copy
                    newEtapa.id = `new_${Date.now()}${Math.random()}`; // New unique ID
                    newEtapa.visualizacaoRH = false; // Reset RH flag

                    // Reset procedure status to 'Pendente' for the copy
                    newEtapa.procedimentos = {};
                    PROCEDIMENTOS_LIST.forEach(p => newEtapa.procedimentos[p.key] = 'Pendente');
                    newEtapa.procedimentos.responsavel = ''; // Clear responsible person

                    // Offset dates: Start the day after the original ends
                    const duration = diffInDays(originalEtapa.data_inicio, originalEtapa.data_fim);
                    newEtapa.data_inicio = addDays(originalEtapa.data_fim, 1); // Start next day
                    newEtapa.data_fim = addDays(newEtapa.data_inicio, duration); // Maintain duration

                    // Insert the new etapa immediately after the original one
                    pedido.etapas.splice(originalEtapaIndex + 1, 0, newEtapa);
                    changed = true;
                }
            } else if (e.target.closest('.remove-etapa-btn')) {
                // Remove an etapa from the current pedido
                const etapaEl = e.target.closest('.etapa-item');
                const etapaId = etapaEl.dataset.id;
                pedido.etapas = (pedido.etapas || []).filter(e => e.id !== etapaId);
                changed = true;
            }

            // Re-render the pedidos/etapas form if any changes occurred
            if (changed) renderPedidosForm();
        });
    }

    const addPedidoBtn = document.getElementById('addPedidoBtn');
     if (addPedidoBtn) {
        addPedidoBtn.addEventListener('click', () => {
            updateTempPedidosFromForm(); // Read current state first
            // Add a new empty pedido object
            const newPedido = {
                id: `new_${Date.now()}${Math.random()}`, // Temporary unique ID
                numero: '', etapas: []
            };
            tempPedidos.push(newPedido);
            renderPedidosForm(); // Re-render the form
        });
     }


    // --- Gantt Chart Interactions ---
    const ganttWrapper = document.getElementById('ganttChartWrapper');
    if (ganttWrapper) {
        ganttWrapper.addEventListener('click', e => {
            if (ganttDragInfo.isDragging) { return; } // Ignore clicks that are part of a drag operation

            const bar = e.target.closest('.gantt-bar');
            if (bar) {
                // --- Handle Clicks on Gantt Bars ---
                if (copyModeState.active) {
                    // --- In Copy Mode ---
                    if (bar.classList.contains('copy-targetable')) {
                        const targetEtapaId = bar.dataset.targetEtapaId;
                        const [targetObra, targetPedido, targetEtapa] = findEtapaParents(targetEtapaId);
                        const [,, sourceEtapa] = findEtapaParents(copyModeState.sourceEtapaId);

                        if (targetEtapa && sourceEtapa) {
                             const message = `Copiar ${copyModeState.colaboradoresToCopy.length} alocado(s) da etapa "${sourceEtapa.nome}" (${sourceEtapa.data_inicio}) para a etapa "${targetEtapa.nome}" (${targetEtapa.data_inicio})? Os colaboradores existentes na etapa de destino serão mantidos.`;
                             // Show confirmation modal before copying
                             showConfirmModal('Confirmar Cópia de Alocados', message, async () => {
                                const obraToUpdate = obras.find(o => o.id === targetObra.id);
                                const updatedPedidos = JSON.parse(JSON.stringify(obraToUpdate.pedidos)); // Deep copy
                                const pedidoToUpdate = updatedPedidos.find(p => p.id === targetPedido.id);
                                const etapaToUpdate = (pedidoToUpdate.etapas || []).find(e => e.id === targetEtapaId);

                                // Merge existing alocados with the copied ones using a Set to avoid duplicates
                                const combined = new Set([...(etapaToUpdate.colaboradores_alocados || []), ...copyModeState.colaboradoresToCopy]);
                                etapaToUpdate.colaboradores_alocados = Array.from(combined);
                                etapaToUpdate.visualizacaoRH = false; // Reset RH flag on modification

                                try {
                                    await updateDoc(doc(obrasCollection, obraToUpdate.id), { pedidos: updatedPedidos });
                                    showToast("Colaboradores copiados com sucesso!");
                                    logInteraction('copy_allocations_success', { from: copyModeState.sourceEtapaId, to: targetEtapaId });
                                    // Log the copy action
                                    const sourceIdentifier = getEtapaLogIdentifier(findEtapaParents(copyModeState.sourceEtapaId)[1], copyModeState.sourceEtapaId);
                                    const targetIdentifier = getEtapaLogIdentifier(pedidoToUpdate, targetEtapaId);
                                    await logActivity(targetObra.id, `copiou alocados da etapa ${sourceIdentifier} para a etapa ${targetIdentifier}.`);

                                } catch (err) {
                                    showToast("Erro ao copiar colaboradores.", "error");
                                    console.error(err);
                                } finally {
                                    exitCopyMode(); // Exit copy mode regardless of success/failure
                                }
                             });
                        }
                    }
                    return; // Don't open modal in copy mode
                }
                // --- Normal Click on Bar ---
                const etapaId = bar.dataset.etapaId;
                // Open alocacao modal only for individual etapa bars (not summary bars)
                if(etapaId && bar.classList.contains('resizable')) {
                     openAlocacaoModal(etapaId);
                }
                return; // Stop further processing if a bar was clicked
            }

            // --- Handle Clicks on Sidebar Icons/Buttons ---
            const expandBtn = e.target.closest('.expand-btn');
            if (expandBtn) {
                // Toggle expanded/collapsed state for the obra/pedido
                const id = expandBtn.dataset.id;
                ganttExpandedState[id] = ganttExpandedState[id] === false; // Toggle boolean state
                saveUserPreferences(); // Save the new state
                renderGanttChart(); // Re-render the Gantt
                return;
            }
            const fechamentoBtn = e.target.closest('.fechamento-btn');
            if(fechamentoBtn) {
                // Open the fechamento/pendencias modal for the obra
                const id = fechamentoBtn.dataset.id;
                openFechamentoModal(id);
                return;
            }
            const editObraTrigger = e.target.closest('.edit-obra-trigger');
            if(editObraTrigger) {
                // Open the obra modal for editing
                const id = editObraTrigger.dataset.id;
                const obra = obras.find(o => o.id === id);
                if (obra) openObraModal(obra);
                return;
            }
            const rhPendencyBtn = e.target.closest('.rh-pendency-btn');
            if (rhPendencyBtn) {
                // Open the info modal focused on the next pending RH procedure
                const groupRow = rhPendencyBtn.closest('.gantt-row');
                const firstEtapaId = groupRow.dataset.id; // ID stored is the first etapa in the group
                const [, pedido, etapa] = findEtapaParents(firstEtapaId);
                if (etapa && pedido) {
                    // Find all etapas in the group
                    const group = (pedido.etapas || []).filter(e => e.nome === etapa.nome).sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
                    // Find etapas that still have pending procedures
                    const pendingEtapas = group.filter(e => !PROCEDIMENTOS_LIST.every(p => e.procedimentos && e.procedimentos[p.key] === 'OK'));
                    if (pendingEtapas.length > 0) {
                        const todayStr = new Date().toISOString().split('T')[0];
                        // Try to find the *next* pending etapa starting from today
                        const nextPendingEtapa = pendingEtapas.find(e => e.data_inicio >= todayStr) || pendingEtapas[0]; // Fallback to the first pending one
                        openInfoEtapaModal(nextPendingEtapa.id);
                    } else {
                        // If somehow the icon was clicked but no pendencies found, open the first one
                        openInfoEtapaModal(firstEtapaId);
                    }
                }
                return;
            }

            // --- Handle Clicks on Sidebar Etapa Group Rows ---
            const etapaGroupRow = e.target.closest('.gantt-row[data-type="etapa-group"]');
            if (etapaGroupRow) {
                // Open the alocacao modal for the first etapa in that group
                const firstEtapaIdInGroup = etapaGroupRow.dataset.id;
                openAlocacaoModal(firstEtapaIdInGroup);
                return;
            }
        });
    }

    // --- Colaborador View Interactions (Currently Minimal) ---
     const colabWrapper = document.getElementById('colaboradorGanttWrapper');
     if (colabWrapper) {
        colabWrapper.addEventListener('click', e => {
            const sidebarRow = e.target.closest('.gantt-row');
            if (!sidebarRow) return;
            // Potentially add actions here later, e.g., view employee details
        });
     }


    // --- Gerenciamento Tab: Empresa/Funcionario List Interactions ---
    const empresaList = document.getElementById('empresaList');
    if (empresaList) {
        empresaList.addEventListener('click', e => {
            const item = e.target.closest('.empresa-item');
            if(!item) return; // Ignore clicks outside items
            const id = item.dataset.id;
            const empresa = empresas.find(em => em.id === id);
            if (!empresa) return;

            if (e.target.closest('.edit-btn')) {
                // Open modal to edit the clicked empresa
                openEmpresaModal(empresa);
                return;
            }
            if (e.target.closest('.delete-btn')) {
                // Handle deleting the empresa
                if (currentUser.perfil === 'Visualizacao') return; // Check permission
                const funcsCount = funcionarios.filter(f => f.empresa_id === id).length;
                // Prevent deletion if employees are associated
                if (funcsCount > 0) {
                    showToast(`Não é possível excluir "${empresa.nome}", existem ${funcsCount} funcionário(s) associados. Remova ou reatribua os funcionários primeiro.`, 'error');
                    return;
                }
                // Show confirmation before deleting
                showConfirmModal('Excluir Empresa', `Tem certeza que deseja excluir a empresa "${empresa.nome}"?`, async () => {
                     try {
                        await deleteDoc(doc(empresasCollection, id));
                        showToast(`Empresa "${empresa.nome}" excluída.`);
                        if (selectedEmpresaId === id) { // If the deleted company was selected
                            selectedEmpresaId = null; // Deselect it
                            renderFuncionarioList(); // Clear the funcionario list
                        }
                     } catch (err) {
                          console.error("Erro ao excluir empresa:", err);
                          showToast(`Falha ao excluir "${empresa.nome}".`, "error");
                     }

                });
                return;
            }
            // --- Handle Selecting an Empresa ---
            selectedEmpresaId = id; // Set the globally selected company ID
            renderEmpresaList(); // Re-render list to show selection highlight
            renderFuncionarioList(); // Render the employees for the selected company
        });
    }

    const funcionarioList = document.getElementById('funcionarioList');
    if (funcionarioList) {
        funcionarioList.addEventListener('click', e => {
            const item = e.target.closest('.p-3'); // Target the employee item container
            if(!item || !item.dataset.id) return; // Ignore clicks outside items or on header
            const id = item.dataset.id;
            const func = funcionarios.find(f => f.id === id);
            if (!func) return;

            if (e.target.closest('.edit-btn')) {
                // Open modal to edit the clicked funcionario
                openFuncionarioModal(func);
                return;
            }
            if (e.target.closest('.delete-btn')) {
                // Handle deleting the funcionario
                if (currentUser.perfil === 'Visualizacao') return; // Check permission

                // Basic check if employee is allocated anywhere (can be slow for many projects)
                let isAllocated = false;
                for(const obra of obras) {
                    for(const pedido of (obra.pedidos || [])) {
                        for(const etapa of (pedido.etapas || [])) {
                             if ((etapa.colaboradores_alocados || []).includes(id) || (etapa.colaboradores_reserva || []).includes(id)) {
                                isAllocated = true;
                                break;
                             }
                        }
                        if (isAllocated) break;
                    }
                    if (isAllocated) break;
                }

                if (isAllocated) {
                     showToast(`Não é possível excluir "${func.nome}", pois ele está alocado ou reservado em uma ou mais etapas. Remova-o das etapas primeiro.`, 'error');
                     return;
                }

                // Show confirmation before deleting
                showConfirmModal('Excluir Funcionário', `Tem certeza que deseja excluir "${func.nome}"?`, async () => {
                     try {
                        await deleteDoc(doc(funcionariosCollection, id));
                        showToast(`Funcionário "${func.nome}" excluído.`);
                        // List updates via onSnapshot
                     } catch(err) {
                         console.error("Erro ao excluir funcionário:", err);
                         showToast(`Falha ao excluir "${func.nome}".`, "error");
                     }
                });
                return;
            }
        });
    }

    // --- Zoom Controls ---
    const handleZoom = (direction, isColaboradorView) => {
        const wrapperSelector = isColaboradorView ? '#colaboradorGanttContainer' : '#ganttChartContainer';
        const timeline = document.querySelector(`${wrapperSelector} .gantt-timeline`);
        if (!timeline) return;

        // Calculate the day position at the center of the viewport before zooming
        const centerPoint = timeline.scrollLeft + (timeline.clientWidth / 2);
        const dayAtCenter = centerPoint / zoomLevels[zoomLevel]; // Current day width

        // Update zoom level
        if (direction === 'in' && zoomLevel < zoomLevels.length - 1) zoomLevel++;
        else if (direction === 'out' && zoomLevel > 0) zoomLevel--;
        else return; // No change if already at min/max zoom

        // Calculate the new scroll position to keep the center day centered
        const newScrollLeft = (dayAtCenter * zoomLevels[zoomLevel]) - (timeline.clientWidth / 2); // New day width

        // Re-render the appropriate Gantt view with the new zoom and scroll position
        if(isColaboradorView) renderColaboradorView(newScrollLeft);
        else renderGanttChart(null, newScrollLeft);
        saveUserPreferences(); // Save the new zoom level
    };
    document.getElementById('zoomInBtn')?.addEventListener('click', () => handleZoom('in', false));
    document.getElementById('zoomOutBtn')?.addEventListener('click', () => handleZoom('out', false));
    document.getElementById('colaboradorZoomInBtn')?.addEventListener('click', () => handleZoom('in', true));
    document.getElementById('colaboradorZoomOutBtn')?.addEventListener('click', () => handleZoom('out', true));

    // --- Sort Controls ---
    document.getElementById('sortAlocacao')?.addEventListener('change', () => renderAlocacaoLists(false)); // Re-render alocacao lists on sort change
    
    // v11.1: Modificação para "descongelar" a lista e salvar preferência
    document.getElementById('colaboradorSort')?.addEventListener('change', () => { 
        preserveSortOrderOnNextRender = false; // "Descongela"
        renderColaboradorView(); 
        saveUserPreferences(); 
    }); 
    document.getElementById('obraSort')?.addEventListener('change', () => { 
        preserveSortOrderOnNextRender = false; // "Descongela"
        renderGanttChart(); 
        saveUserPreferences(); 
    }); 
    
    document.getElementById('integracaoSort')?.addEventListener('change', renderIntegracoesView); // Re-render integracoes view


     // --- Filter Controls ---
    document.getElementById('alocacaoSearch')?.addEventListener('input', () => renderAlocacaoLists(true)); // Re-render alocacao on search input (pass true)
    // Integration filters in Alocacao modal
    document.getElementById('filtroBRF')?.addEventListener('change', () => renderAlocacaoLists(true));
    document.getElementById('filtroJBS')?.addEventListener('change', () => renderAlocacaoLists(true));
    // Integration filters in Integracoes tab
    document.getElementById('integracaoFiltroBRF')?.addEventListener('change', renderIntegracoesView);
    document.getElementById('integracaoFiltroJBS')?.addEventListener('change', renderIntegracoesView);
    // v11.4: Adiciona listener para o novo filtro de status (Tarefa 1)
    document.getElementById('integracaoFiltroStatus')?.addEventListener('change', renderIntegracoesView);


    // --- Label Toggle Buttons ---
    const toggleLabel = () => {
        obraLabelType = obraLabelType === 'numero' ? 'nome' : 'numero'; // Toggle between 'numero' and 'nome'
        updateObraLabelBtn(); // Update button text
        // Re-render relevant views
        if (currentTab === 'Gantt') renderGanttChart();
        if (currentTab === 'Colaboradores') renderColaboradorView();
        saveUserPreferences(); // Save the preference
    };
    document.getElementById('toggleObraLabelBtn')?.addEventListener('click', toggleLabel);
    document.getElementById('toggleColaboradorLabelBtn')?.addEventListener('click', toggleLabel);

    // --- Debug Log Controls ---
    document.getElementById('toggleLogBtn')?.addEventListener('click', toggleLogging);
    document.getElementById('downloadLogBtn')?.addEventListener('click', downloadLogs);

    // --- Modal Navigation/Actions ---
    document.getElementById('infoFromAlocacaoBtn')?.addEventListener('click', () => {
        // Close alocacao modal and open info modal for the same etapa
        closeModal(document.getElementById('alocacaoModal'));
        setTimeout(() => openInfoEtapaModal(currentAlocacaoEtapaId), 300); // Delay opening slightly for smoother transition
    });
    document.getElementById('generateEtapaReportBtn')?.addEventListener('click', () => {
        if(currentAlocacaoEtapaId) generateEtapaReport(currentAlocacaoEtapaId);
    });
    document.getElementById('generateObraReportBtn')?.addEventListener('click', () => {
         const obraId = document.getElementById('obraId')?.value;
         if(obraId) generateObraReport(obraId);
    });
    document.getElementById('deleteObraBtn')?.addEventListener('click', () => {
         if (currentUser.perfil === 'Visualizacao') return; // Check permission
         const obraId = document.getElementById('obraId')?.value;
         const obra = obras.find(o => o.id === obraId);
         if (obra) {
            // Show confirmation before deleting obra
            showConfirmModal('Excluir Projeto', `Tem certeza que deseja excluir o projeto "${obra.nome}" (${obra.numero})? Todas os pedidos e etapas associados serão perdidos permanentemente. Esta ação não pode ser desfeita.`, async () => {
                try {
                    await deleteDoc(doc(obrasCollection, obraId));
                    closeModal(document.getElementById('obraModal'));
                    showToast(`Projeto "${obra.nome}" excluído.`);
                    logInteraction('delete_obra', { id: obraId, nome: obra.nome });
                    // Data updates via onSnapshot
                } catch(err) {
                    console.error("Erro ao excluir projeto:", err);
                    showToast(`Falha ao excluir "${obra.nome}".`, "error");
                }
            });
         }
    });
    document.getElementById('activityLogBtn')?.addEventListener('click', () => {
         const obraId = document.getElementById('obraId')?.value;
         if(obraId) openActivityLogModal(obraId);
    });
    document.getElementById('pendenciasFromObraModalBtn')?.addEventListener('click', () => {
        // Open fechamento modal from the obra modal context
        const obraId = document.getElementById('obraId')?.value;
        if(obraId) {
            // Close obra modal first? Optional, might be better to keep it open.
            // closeModal(document.getElementById('obraModal'));
            openFechamentoModal(obraId);
        }
    });
    // Button to add new logistics item in Info Etapa modal
    document.getElementById('addLogisticaBtn')?.addEventListener('click', () => {
        const container = document.getElementById('logisticaContainer');
        // Clear placeholder if present
        const placeholder = container?.querySelector('p');
        if(placeholder) placeholder.remove();
        // Add new empty row
        const el = document.createElement('div');
        el.className = 'grid grid-cols-12 gap-2 items-center';
        el.innerHTML = `
            <input type="text" placeholder="Carro" class="logistica-carro col-span-4 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <input type="text" placeholder="Motorista" class="logistica-motorista col-span-4 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <input type="datetime-local" class="logistica-saida col-span-3 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <button type="button" class="remove-logistica-btn action-btn text-red-500 hover:text-red-400"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd" /></svg></button>
        `;
        if (container) container.appendChild(el);
    });
    // Event listener for removing logistics items
    document.getElementById('logisticaContainer')?.addEventListener('click', e => {
         const removeBtn = e.target.closest('.remove-logistica-btn');
         if (removeBtn) {
            removeBtn.closest('.grid').remove(); // Remove the parent row
             // Optional: Add back placeholder if list becomes empty
             const container = document.getElementById('logisticaContainer');
             if (container && container.children.length === 0) {
                 container.innerHTML = '<p class="text-xs text-gray-500 text-center py-2">Nenhum veículo adicionado.</p>';
             }
         }
    });

    // --- Login Form ---
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async e => {
            e.preventDefault();
            const login = document.getElementById('loginUsuario').value.toLowerCase().trim();
            const senha = document.getElementById('loginSenha').value;
            const errorEl = document.getElementById('loginError');
            if(errorEl) errorEl.classList.add('hidden'); // Hide previous errors

            // --- Simple hardcoded admin check (Insecure - Use Firebase Auth!) ---
            if (login === 'admin' && senha === 'BRYant01') {
                currentUser = { id: 'admin_local', nome: 'Administrador', login: 'admin', perfil: 'admin' }; // Use a distinct ID for local admin
                console.log("Admin login successful (local check).");
                await startApp(); // Proceed to start the app
                return;
            }

            // --- Check against users in Firestore ---
            // Ensure `users` array is populated (usually handled by initial onSnapshot)
            if (!users || users.length === 0) {
                 if(errorEl) {
                     errorEl.textContent = 'Erro ao carregar usuários. Tente novamente.';
                     errorEl.classList.remove('hidden');
                 }
                 console.error("Login attempt failed: Users array not populated.");
                 return;
            }

            const userFound = users.find(u => u.login === login && u.senha === senha); // Plain text password check (INSECURE!)
            if (userFound) {
                currentUser = userFound; // Set the globally logged-in user
                console.log(`User login successful: ${currentUser.nome} (${currentUser.perfil})`);
                await startApp(); // Proceed to start the app
            } else {
                 if(errorEl) {
                    errorEl.textContent = 'Usuário ou senha inválidos.';
                    errorEl.classList.remove('hidden');
                 }
                logInteraction('login_failed', { login });
            }
        });
    }
    // --- Fechamento Modal Interactions ---
    const fechamentoModal = document.getElementById('fechamentoModal');
    if (fechamentoModal) {
        // Button to add a new pendencia item
        const addPendenciaBtn = document.getElementById('addPendenciaBtn');
        if (addPendenciaBtn) {
            addPendenciaBtn.addEventListener('click', () => {
                const input = document.getElementById('newPendenciaInput');
                const texto = input ? input.value.trim() : '';
                if(texto) {
                    const list = document.getElementById('pendenciasList');
                    const index = list ? list.children.length : 0; // Use current length as index for new item
                    const pendenciaEl = document.createElement('div');
                    pendenciaEl.className = 'flex items-center justify-between bg-gray-700/50 p-2 rounded';
                    pendenciaEl.innerHTML = `
                        <div class="flex items-center flex-grow mr-2">
                            <input id="pendencia-${index}" type="checkbox" class="h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 pendencia-checkbox flex-shrink-0" data-index="${index}">
                            <label for="pendencia-${index}" class="ml-2 break-words">${texto}</label>
                        </div>
                        <button class="remove-pendencia-btn action-btn text-red-500 flex-shrink-0" data-index="${index}">
                            <svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd"></path></svg>
                        </button>
                    `;
                    if (list) list.appendChild(pendenciaEl);
                    if (input) input.value = ''; // Clear input field
                }
            });
        }

        // Event listener for interactions within the pendencias list (remove or check/uncheck)
        const pendenciasList = document.getElementById('pendenciasList');
        if (pendenciasList) {
            pendenciasList.addEventListener('click', e => {
                const removeBtn = e.target.closest('.remove-pendencia-btn');
                if (removeBtn) {
                    removeBtn.closest('.flex').remove(); // Remove the entire pendencia item
                    // Re-index remaining items if necessary (optional, but good practice if indices are crucial)
                    // ... (re-indexing logic would go here) ...
                    return;
                }
                 const checkbox = e.target.closest('.pendencia-checkbox');
                 if (checkbox) {
                    // Toggle line-through style on the label when checkbox state changes
                    const label = checkbox.nextElementSibling;
                    if (label) {
                        label.classList.toggle('line-through', checkbox.checked);
                        label.classList.toggle('text-gray-500', checkbox.checked);
                    }
                }
            });
        }
    }


    // --- Settings Modal (Admin Only) ---
    document.getElementById('settingsBtn')?.addEventListener('click', openSettingsModal); // Open settings
    document.getElementById('clearUserFormBtn')?.addEventListener('click', clearUserForm); // Clear the user add/edit form
    // Event listener for user list interactions (edit/delete)
    const userListContainer = document.getElementById('userListContainer');
    if (userListContainer) {
        userListContainer.addEventListener('click', e => {
            const editBtn = e.target.closest('.edit-user-btn');
            const deleteBtn = e.target.closest('.delete-user-btn');
            if (editBtn) {
                // Populate form for editing the selected user
                const user = users.find(u => u.id === editBtn.dataset.id);
                if (user) {
                    document.getElementById('userFormTitle').textContent = `Editando: ${user.nome}`;
                    document.getElementById('userId').value = user.id;
                    document.getElementById('userNome').value = user.nome;
                    document.getElementById('userLogin').value = user.login;
                    document.getElementById('userPerfil').value = user.perfil;
                    document.getElementById('userSenha').value = ''; // Clear password field
                    document.getElementById('userSenha').required = false; // Password not required for editing
                    document.getElementById('userSenha').placeholder = 'Deixe em branco para não alterar';
                }
            } else if(deleteBtn) {
                // Handle deleting the selected user
                const user = users.find(u => u.id === deleteBtn.dataset.id);
                if(user) {
                    // Prevent admin from deleting themselves
                    if (user.id === currentUser?.id) {
                        showToast("Não é possível excluir o próprio usuário.", "error");
                        return;
                    }
                     // Show confirmation before deleting user
                    showConfirmModal("Excluir Usuário", `Tem certeza que deseja excluir o usuário ${user.nome} (${user.login})?`, async () => {
                         try {
                            await deleteDoc(doc(usersCollection, user.id));
                            showToast("Usuário excluído.");
                            clearUserForm(); // Reset form if the deleted user was being edited
                            logInteraction('delete_user', { id: user.id, nome: user.nome });
                            // List updates via onSnapshot
                         } catch(err) {
                              console.error("Erro ao excluir usuário:", err);
                              showToast("Falha ao excluir usuário.", "error");
                         }
                    });
                }
            }
        });
    }

    // --- Copy Mode Buttons ---
    document.getElementById('copyAllocationsBtn')?.addEventListener('click', () => {
        if(currentAlocacaoEtapaId) enterCopyMode(currentAlocacaoEtapaId);
    });
    document.getElementById('cancelCopyModeBtn')?.addEventListener('click', exitCopyMode);

    // --- Info Etapa Modal Navigator ---
    document.getElementById('infoEtapaNavPrev')?.addEventListener('click', () => {
        const { group, index } = currentInfoEtapaGroupContext;
        if (group && index > 0) openInfoEtapaModal(group[index - 1].id); // Open previous etapa in group
    });
    document.getElementById('infoEtapaNavNext')?.addEventListener('click', () => {
        const { group, index } = currentInfoEtapaGroupContext;
        if (group && index < group.length - 1) openInfoEtapaModal(group[index + 1].id); // Open next etapa in group
    });

    // --- Comentarios Interactions (Edit/Delete) ---
     const comentariosContainer = document.getElementById('comentariosContainer');
     if (comentariosContainer) {
        comentariosContainer.addEventListener('click', (e) => {
            const commentItem = e.target.closest('.comment-item');
            if (!commentItem || !commentItem.dataset.index) return; // Ignore clicks outside comment items or if index is missing
            const commentIndex = parseInt(commentItem.dataset.index, 10); // Get original index

            if (e.target.closest('.delete-comment-btn')) {
                handleDeleteComentario(commentIndex); // Trigger delete handler
            } else if (e.target.closest('.edit-comment-btn')) {
                handleEditComentario(commentIndex); // Trigger edit handler
            }
        });
     }

     // --- Gantt Bar Drag & Resize ---
    const ganttChartWrapper = document.getElementById('ganttChartWrapper');
    if (ganttChartWrapper) {
        ganttChartWrapper.addEventListener('mousedown', (e) => {
            // Prevent drag/resize for Visualizacao profile or if in copy mode
            if(currentUser?.perfil === 'Visualizacao' || copyModeState.active) return;
            const bar = e.target.closest('.gantt-bar.resizable'); // Target only resizable bars (individual etapas)
            if (!bar) return;

            const etapaId = bar.dataset.etapaId;
            const [,,etapa] = findEtapaParents(etapaId);
            if(!etapa) return; // Exit if etapa data not found

            // Determine drag type based on where the mousedown occurred
            let dragType;
            if (e.target.classList.contains('gantt-bar-handle-left')) dragType = 'resize-left';
            else if (e.target.classList.contains('gantt-bar-handle-right')) dragType = 'resize-right';
            else dragType = 'drag'; // Default to dragging the whole bar

            // Change cursor style based on drag type
            document.body.style.cursor = (dragType === 'resize-left' || dragType === 'resize-right') ? 'ew-resize' : 'grabbing';

            // Store initial state for drag calculation
            ganttDragInfo = {
                isDragging: false, // Flag set to true only after significant movement
                type: dragType,
                bar: bar,
                id: etapa.id,
                initialX: e.clientX,
                initialLeft: bar.offsetLeft,
                initialWidth: bar.offsetWidth,
                initialStartDate: etapa.data_inicio,
                initialEndDate: etapa.data_fim
            };

            // Add global listeners for mouse move and mouse up
            window.addEventListener('mousemove', handleGanttMouseMove);
            window.addEventListener('mouseup', handleGanttMouseUp);
        });
    }


    // --- Global Search ---
     const globalSearchInput = document.getElementById('globalSearchInput');
     if (globalSearchInput) {
        // Use 'input' event for real-time filtering as user types
        globalSearchInput.addEventListener('input', handleGlobalSearch);
     }


    // --- Notifications ---
    const notificationsBtn = document.getElementById('notificationsBtn');
    if (notificationsBtn) {
        notificationsBtn.addEventListener('click', toggleNotificationMenu);
    }
    // Listener for clicking on a notification item to mark as read and potentially navigate
    const notificationMenu = document.getElementById('notificationMenu');
    if (notificationMenu) {
        notificationMenu.addEventListener('click', async (e) => {
            const item = e.target.closest('.notification-item');
            if (!item || !currentUser) return; // Ensure item and user exist

            const obraId = item.dataset.obraId;
            const notificationId = item.dataset.notificationId;

            // --- Mark as read in Firestore ---
            // Find the notification in the local array first
            const notification = notificacoes.find(n => n.id === notificationId);
            if (notification && (!notification.readBy || !notification.readBy.includes(currentUser.id))) {
                 // Update Firestore only if it wasn't already marked as read by this user
                 const notifRef = doc(notificacoesCollection, notificationId);
                 try {
                     await updateDoc(notifRef, {
                         readBy: arrayUnion(currentUser.id) // Add current user's ID to the readBy array
                     });
                     // Optimistically update UI immediately (or rely on onSnapshot)
                     item.classList.remove('bg-blue-900/30'); // Remove unread highlight
                     // Badge update happens via onSnapshot automatically
                     logInteraction('mark_notification_read', { id: notificationId });
                 } catch (error) {
                      console.error("Erro ao marcar notificação como lida:", error);
                      // Optionally show error to user
                 }
            } else {
                 // Already read, just remove highlight if needed (might happen if UI update was slow)
                 item.classList.remove('bg-blue-900/30');
            }


            // --- Navigation ---
            // Ensure the related obra is visible in the Gantt chart
            if (!activeProjectIds.includes(obraId)) {
                activeProjectIds.push(obraId); // Add temporarily if archived
                // Persist the change so it stays visible
                await setDoc(doc(settingsCollection, 'activeProjects'), { ids: activeProjectIds });
            }
            // Switch to Gantt tab (onSnapshot listener for obras will handle the re-render)
            if (currentTab !== 'Gantt') {
                switchTab('Gantt');
            } else {
                // If already on Gantt, potentially scroll to the project (more complex)
                // For now, just ensuring it's visible is sufficient.
            }

            // Close the notification menu
            if (notificationMenu.style.display === 'block') {
                 toggleNotificationMenu();
            }
        });
    }

     // --- RH Confirmation Button (Alocacao Modal) ---
    document.getElementById('confirmVisualizacaoBtn')?.addEventListener('click', handleConfirmVisualizacao);


}; // --- END of setupEventListeners ---

const handleGanttMouseMove = (e) => {
    if (!ganttDragInfo || !ganttDragInfo.type) return; // Exit if not dragging
    e.preventDefault(); // Prevent text selection during drag

    const deltaX = e.clientX - ganttDragInfo.initialX;
    // Set isDragging flag only after moving a minimum distance (e.g., 5 pixels)
    // This distinguishes a drag from a simple click
    if (!ganttDragInfo.isDragging && Math.abs(deltaX) > 5) {
        ganttDragInfo.isDragging = true;
    }

    if(!ganttDragInfo.isDragging) return; // Don't update UI until dragging actually starts

    const dayWidth = zoomLevels[zoomLevel];
    const deltaDays = Math.round(deltaX / dayWidth); // Calculate change in days

    // --- Update Bar Position/Width Visually based on Drag Type ---
    if (ganttDragInfo.type === 'drag') {
        // Move the entire bar
        const newLeft = ganttDragInfo.initialLeft + (deltaDays * dayWidth);
        ganttDragInfo.bar.style.left = `${Math.max(0, newLeft)}px`; // Prevent negative left position
    } else if (ganttDragInfo.type === 'resize-right') {
        // Resize by changing width (right handle)
        const newWidth = Math.max(dayWidth, ganttDragInfo.initialWidth + (deltaDays * dayWidth)); // Ensure minimum width of one day
        ganttDragInfo.bar.style.width = `${newWidth}px`;
    } else if (ganttDragInfo.type === 'resize-left') {
        // Resize by changing left position and width (left handle)
        const newLeft = ganttDragInfo.initialLeft + (deltaDays * dayWidth);
        const newWidth = ganttDragInfo.initialWidth - (deltaDays * dayWidth);
        // Apply changes only if the new width is valid (at least one day)
        if(newWidth >= dayWidth) {
            ganttDragInfo.bar.style.left = `${Math.max(0, newLeft)}px`;
            ganttDragInfo.bar.style.width = `${newWidth}px`;
        }
    }
};

const handleGanttMouseUp = async (e) => {
    if (!ganttDragInfo || !ganttDragInfo.type) return; // Exit if not dragging

    // --- Cleanup ---
    document.body.style.cursor = 'default'; // Restore default cursor
    // Remove global listeners
    window.removeEventListener('mousemove', handleGanttMouseMove);
    window.removeEventListener('mouseup', handleGanttMouseUp);

    // If it wasn't a real drag (just a click), reset info and exit
    if (!ganttDragInfo.isDragging) {
        ganttDragInfo = { isDragging: false };
        // Trigger a click event manually if needed, or handle click logic elsewhere
        // ganttDragInfo.bar.click(); // Example if click needed
        return;
    }

    // --- Calculate Final Changes ---
    const dayWidth = zoomLevels[zoomLevel];
    const deltaX = e.clientX - ganttDragInfo.initialX;
    const deltaDays = Math.round(deltaX / dayWidth); // Final change in days

    const [obra, pedido, etapa] = findEtapaParents(ganttDragInfo.id);
    // If etapa data not found (e.g., deleted during drag), revert UI and exit
    if(!obra || !pedido || !etapa) {
        console.warn("Etapa not found after drag, reverting visual change.");
        ganttDragInfo = { isDragging: false };
        renderGanttChart(null, lastKnownScrollLeft); // Re-render to reset bar position
        return;
    }

    // --- Determine New Start and End Dates ---
    let newStartDate = etapa.data_inicio;
    let newEndDate = etapa.data_fim;

    if (ganttDragInfo.type === 'drag') {
        newStartDate = addDays(etapa.data_inicio, deltaDays);
        newEndDate = addDays(etapa.data_fim, deltaDays);
    } else if (ganttDragInfo.type === 'resize-right') {
        newEndDate = addDays(etapa.data_fim, deltaDays);
        // Ensure end date doesn't become earlier than start date
        if (new Date(newEndDate) < new Date(etapa.data_inicio)) newEndDate = etapa.data_inicio;
    } else if (ganttDragInfo.type === 'resize-left') {
        newStartDate = addDays(etapa.data_inicio, deltaDays);
         // Ensure start date doesn't become later than end date
        if (new Date(newStartDate) > new Date(etapa.data_fim)) newStartDate = etapa.data_fim;
    }

    // --- Prepare Log Message ---
    const etapaIdentifier = getEtapaLogIdentifier(pedido, etapa.id);
    let logMessage = '';
    const startChanged = newStartDate !== etapa.data_inicio;
    const endChanged = newEndDate !== etapa.data_fim;

    if (startChanged && endChanged) {
        logMessage = `arrastou/redimensionou a etapa ${etapaIdentifier} para ${newStartDate} a ${newEndDate}.`;
    } else if (startChanged) {
         logMessage = `alterou a data inicial da etapa ${etapaIdentifier} para ${newStartDate}.`;
    } else if (endChanged) {
         logMessage = `alterou a data final da etapa ${etapaIdentifier} para ${newEndDate}.`;
    }

    // --- Validate Overlap within the Same Group (Client-Side Check) ---
    const otherEtapasInGroup = (pedido.etapas || []).filter(e => e.nome === etapa.nome && e.id !== etapa.id);
    let hasConflict = false;
    for (const other of otherEtapasInGroup) {
        if (new Date(newStartDate) <= new Date(other.data_fim) && new Date(newEndDate) >= new Date(other.data_inicio)) {
            hasConflict = true;
            break;
        }
    }

    // If overlap detected, show error, revert UI, and exit
    if (hasConflict) {
        showToast('Conflito de datas! A operação sobrepõe outra tarefa na mesma linha.', 'error');
        renderGanttChart(null, lastKnownScrollLeft); // Re-render to reset bar
        ganttDragInfo = { isDragging: false };
        return;
    }

    // --- Save Changes if Dates Changed ---
    if (startChanged || endChanged) {
        // --- Prepare Update Data ---
        const updatedPedidos = JSON.parse(JSON.stringify(obra.pedidos)); // Deep copy
        const pedidoToUpdate = updatedPedidos.find(p => p.id === pedido.id);
        const etapaToUpdate = (pedidoToUpdate?.etapas || []).find(e => e.id === etapa.id);

        if (!etapaToUpdate) { // Safety check
             console.error("Failed to find etapa to update after drag.");
             renderGanttChart(null, lastKnownScrollLeft);
             ganttDragInfo = { isDragging: false };
             return;
        }

        etapaToUpdate.data_inicio = newStartDate;
        etapaToUpdate.data_fim = newEndDate;
        // Reset RH visualization flag if user is not Admin/RH
        if (currentUser.perfil !== 'admin' && currentUser.perfil !== 'RH') {
            etapaToUpdate.visualizacaoRH = false;
        }

        // v11.2: Seta a flag ANTES de salvar no DB para evitar "race condition" com onSnapshot
        preserveSortOrderOnNextRender = true; 

        try {
            // --- Update Firestore ---
            await updateDoc(doc(obrasCollection, obra.id), { pedidos: updatedPedidos });
            // Log the action if a message was prepared
            if (logMessage) {
                await logActivity(obra.id, logMessage);
                if (etapaToUpdate.visualizacaoRH === false && etapa.visualizacaoRH === true) {
                     await logActivity(obra.id, `resetou a confirmação de visualização da etapa ${etapaIdentifier} devido a alteração de data.`);
                }
            }
            showToast("Datas da etapa atualizadas.");
             logInteraction('update_etapa_dates_drag', { id: etapa.id, start: newStartDate, end: newEndDate });
             // No need to manually re-render here, onSnapshot will handle it.
             // Store current scroll position before onSnapshot potentially re-renders
             lastKnownScrollLeft = document.querySelector('#ganttChartContainer .gantt-timeline')?.scrollLeft ?? lastKnownScrollLeft;
        } catch(err) {
            console.error("Erro ao atualizar etapa:", err);
            showToast("Erro ao atualizar datas.", "error");
            preserveSortOrderOnNextRender = false; // v11.2: Reseta a flag em caso de erro no salvamento
            renderGanttChart(null, lastKnownScrollLeft); // Re-render to revert visual change on error
        }
    }
    // Reset drag info state
    ganttDragInfo = { isDragging: false };
}; // --- END of handleGanttMouseUp ---


// --- BUSCA GLOBAL ---
const handleGlobalSearch = () => {
    const searchInput = document.getElementById('globalSearchInput');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // If search term is empty, render the default Gantt view based on active projects
    if (!searchTerm) {
        if(currentTab === 'Gantt') renderGanttChart(); // Render using activeProjectIds
        // No filtering needed for other tabs based on global search
        return;
    }

    // --- Filter Obras based on Search Term ---
    const newExpandedState = {}; // Store IDs to expand based on matches
    const filteredObras = obras.filter(obra => {
        let obraMatch = false; // Does the obra itself match?
        // Check obra name and number
        if (obra.nome.toLowerCase().includes(searchTerm) || obra.numero.toLowerCase().includes(searchTerm)) {
            obraMatch = true;
        }

        // --- Filter Pedidos and Etapas within the Obra ---
        const filteredPedidos = (obra.pedidos || []).map(pedido => {
            let pedidoMatch = false; // Does the pedido itself match?
            // Check pedido number
            if (pedido.numero.toLowerCase().includes(searchTerm)) {
                pedidoMatch = true;
            }

            // --- Filter Etapas within the Pedido ---
            const filteredEtapas = (pedido.etapas || []).filter(etapa => {
                let etapaMatch = false; // Does the etapa itself match?
                // Check etapa name
                if (etapa.nome.toLowerCase().includes(searchTerm)) {
                    etapaMatch = true;
                }

                // Check allocated employees in the etapa
                const alocadosMatch = (etapa.colaboradores_alocados || []).some(funcId => {
                    const func = funcionarios.find(f => f.id === funcId);
                    // Check if employee exists and name matches search term
                    return func && func.nome.toLowerCase().includes(searchTerm);
                });

                if (alocadosMatch) etapaMatch = true; // Match if allocated employee found

                // If etapa matches (name or employee), mark its parents for expansion
                if (etapaMatch) {
                    newExpandedState[obra.id] = true;
                    newExpandedState[pedido.id] = true;
                }
                return etapaMatch; // Keep etapa if it matches
            });

            // If the pedido number matches OR any of its etapas match, keep the pedido
            if (pedidoMatch || filteredEtapas.length > 0) {
                 newExpandedState[obra.id] = true; // Mark obra for expansion
                 // Return the pedido, including only matching etapas if filtering occurred at etapa level
                 // If only pedido number matched, return all original etapas
                 return { ...pedido, etapas: filteredEtapas.length > 0 ? filteredEtapas : pedido.etapas };
            }
            return null; // Discard pedido if neither it nor its children match

        }).filter(Boolean); // Remove null entries (discarded pedidos)

        // Keep the obra if its name/number matched OR any of its children (pedidos/etapas) matched
        if(obraMatch || filteredPedidos.length > 0) {
            // If only obra matched, ensure it's marked for expansion (might be collapsed otherwise)
            if(filteredPedidos.length === 0) newExpandedState[obra.id] = true;
             // Return the obra, including only matching filtered pedidos, or all original pedidos if only obra matched
            return { ...obra, pedidos: filteredPedidos.length > 0 ? filteredPedidos : obra.pedidos };
        }
        return false; // Discard obra if nothing matched
    });

    // Apply the new expanded state derived from search matches
    ganttExpandedState = newExpandedState;
    // Switch to Gantt tab if not already there, and render with filtered results
    if(currentTab !== 'Gantt') switchTab('Gantt'); // This will call renderGanttChart via switchTab
    else renderGanttChart(filteredObras); // Pass the filtered list directly if already on Gantt tab
};

// --- NOTIFICAÇÕES ---
const renderNotifications = () => {
    const menu = document.getElementById('notificationMenu');
    const badge = document.getElementById('notification-badge');
    if (!menu || !badge || !currentUser) return; // Ensure elements and user exist

    // Filter notifications that haven't been read by the current user
    const unread = notificacoes.filter(n => !n.readBy || !n.readBy.includes(currentUser.id));

    // Update badge count
    if (unread.length > 0) {
        badge.textContent = unread.length > 9 ? '9+' : unread.length; // Show count or 9+
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden'); // Hide badge if no unread notifications
    }

    // Render notification items in the dropdown menu
    if (notificacoes.length === 0) {
        menu.innerHTML = `<div class="p-4 text-sm text-gray-400">Nenhuma notificação recente.</div>`;
    } else {
        menu.innerHTML = notificacoes.map(n => {
            const isUnread = unread.some(ur => ur.id === n.id);
            // Format timestamp (handle potential nulls or different types)
            let timeStr = 'Data indisponível';
            if (n.timestamp) {
                const date = n.timestamp.toDate ? n.timestamp.toDate() : (n.timestamp instanceof Date ? n.timestamp : null);
                if (date) timeStr = date.toLocaleString('pt-BR');
            }

            return `
                <div class="p-3 border-b border-gray-700 hover:bg-gray-800 cursor-pointer notification-item ${isUnread ? 'bg-blue-900/30' : ''}" data-obra-id="${n.obraId}" data-notification-id="${n.id}">
                    <p class="text-sm font-semibold">${n.obraNome || 'Projeto Desconhecido'}</p>
                    <p class="text-sm text-gray-300">${n.user || 'Sistema'}: ${n.message || ''}</p>
                    <p class="text-xs text-gray-500 text-right">${timeStr}</p>
                </div>
            `;
        }).join('');
    }
};

// Global listener to close notification menu when clicking outside
const handleOutsideClickForNotifications = (event) => {
    const menu = document.getElementById('notificationMenu');
    const button = document.getElementById('notificationsBtn');

    // If click is inside the button or menu, do nothing
    if (!menu || !button || button.contains(event.target) || menu.contains(event.target)) {
        return;
    }

    // Otherwise, hide the menu and remove the listener
    menu.style.display = 'none';
    document.removeEventListener('click', handleOutsideClickForNotifications, true);
};

const toggleNotificationMenu = async () => {
    if (!currentUser) return; // Don't open if not logged in
    const menu = document.getElementById('notificationMenu');
    if (!menu) return;
    const isVisible = menu.style.display === 'block';

    if (isVisible) {
        // Hide menu and remove outside click listener
        menu.style.display = 'none';
        document.removeEventListener('click', handleOutsideClickForNotifications, true);
    } else {
        // Show menu and add outside click listener
        menu.style.display = 'block';
        document.addEventListener('click', handleOutsideClickForNotifications, true);

        // --- Mark visible notifications as read after a delay ---
        // Get IDs of currently unread notifications
        const unreadIds = notificacoes
            .filter(n => !n.readBy || !n.readBy.includes(currentUser.id))
            .map(n => n.id);

        // Use setTimeout to allow user to see the unread state briefly
        setTimeout(async () => {
            // Only proceed if the menu is still open after the delay
            if (menu.style.display === 'block' && unreadIds.length > 0) {
                console.log(`Marking ${unreadIds.length} notifications as read for user ${currentUser.id}`);
                // Batch update Firestore (more efficient for many updates, but simple loop here)
                for (const id of unreadIds) {
                    const notifRef = doc(notificacoesCollection, id);
                    try {
                        // Add current user's ID to the readBy array
                        await updateDoc(notifRef, {
                            readBy: arrayUnion(currentUser.id)
                        });
                         logInteraction('auto_mark_notification_read', { id });
                    } catch (error) {
                         console.error(`Erro ao marcar notificação ${id} como lida:`, error);
                         // Don't stop marking others if one fails
                    }
                }
                 // Badge count will update automatically via onSnapshot
            }
        }, 2500); // Delay marking as read by 2.5 seconds
    }
};


// --- App Initialization ---
// --- App Initialization ---
// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Set footer text with current year and version
    const footer = document.getElementById('footer-text');
    if (footer) {
        // MODIFICAÇÃO v12.0: Atualiza número da versão no rodapé
        footer.innerHTML = `&copy; ${new Date().getFullYear()} FRINOX | Desenvolvido por Alisson Araújo. Versão 12.1`;
    }
    updateObraLabelBtn(); // Set initial text for label toggle buttons
    setupEventListeners(); // Attach all event listeners
    initialize(); // Initialize Firebase and show login modal
});


// --- v10.5 ---

