// --- STATE VARIABLES ---
let obrasCollection, funcionariosCollection, empresasCollection, settingsCollection, usersCollection, userPreferencesCollection, notificacoesCollection;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'controle-obras-frinox';

let currentUser = null;
let obras = [], funcionarios = [], empresas = [], users = [], obraOrder = [], activeProjectIds = [], notificacoes = [];
let tempPedidos = [];

let ganttExpandedState = {};
let selectedEmpresaId = null;
let currentAlocacaoEtapaId = null;
let currentInfoEtapaId = null;
let currentEtapaGroupContext = {};
let currentInfoEtapaGroupContext = {};
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
let currentObraRenderOrder = [];

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

// --- SETTERS ---
const setObrasCollection = (value) => { obrasCollection = value; };
const setFuncionariosCollection = (value) => { funcionariosCollection = value; };
const setEmpresasCollection = (value) => { empresasCollection = value; };
const setSettingsCollection = (value) => { settingsCollection = value; };
const setUsersCollection = (value) => { usersCollection = value; };
const setUserPreferencesCollection = (value) => { userPreferencesCollection = value; };
const setNotificacoesCollection = (value) => { notificacoesCollection = value; };
const setCurrentUser = (value) => { currentUser = value; };
const setObras = (value) => { obras = value; };
const setFuncionarios = (value) => { funcionarios = value; };
const setEmpresas = (value) => { empresas = value; };
const setUsers = (value) => { users = value; };
const setObraOrder = (value) => { obraOrder = value; };
const setActiveProjectIds = (value) => { activeProjectIds = value; };
const setNotificacoes = (value) => { notificacoes = value; };
const setTempPedidos = (value) => { tempPedidos = value; };
const setGanttExpandedState = (value) => { ganttExpandedState = value; };
const setSelectedEmpresaId = (value) => { selectedEmpresaId = value; };
const setCurrentAlocacaoEtapaId = (value) => { currentAlocacaoEtapaId = value; };
const setCurrentInfoEtapaId = (value) => { currentInfoEtapaId = value; };
const setCurrentEtapaGroupContext = (value) => { currentEtapaGroupContext = value; };
const setCurrentInfoEtapaGroupContext = (value) => { currentInfoEtapaGroupContext = value; };
const setActiveAlocacaoSortables = (value) => { activeAlocacaoSortables = value; };
const setActiveHotelSortables = (value) => { activeHotelSortables = value; };
const setActiveProjectsSortables = (value) => { activeProjectsSortables = value; };
const setGanttSidebarSortable = (value) => { ganttSidebarSortable = value; };
const setCurrentTab = (value) => { currentTab = value; };
const setObraLabelType = (value) => { obraLabelType = value; };
const setZoomLevel = (value) => { zoomLevel = value; };
const setLastKnownScrollLeft = (value) => { lastKnownScrollLeft = value; };
const setGanttDragInfo = (value) => { ganttDragInfo = value; };
const setCopyModeState = (value) => { copyModeState = value; };
const setUnsubscribeNotifications = (value) => { unsubscribeNotifications = value; };
const setPreserveSortOrderOnNextRender = (value) => { preserveSortOrderOnNextRender = value; };
const setCurrentObraRenderOrder = (value) => { currentObraRenderOrder = value; };
const setIsLoggingEnabled = (value) => { isLoggingEnabled = value; };
const setSystemLogs = (value) => { systemLogs = value; };

// --- EXPORTS ---
export {
    obrasCollection, funcionariosCollection, empresasCollection, settingsCollection, usersCollection, userPreferencesCollection, notificacoesCollection,
    appId,
    currentUser,
    obras, funcionarios, empresas, users, obraOrder, activeProjectIds, notificacoes,
    tempPedidos,
    ganttExpandedState,
    selectedEmpresaId,
    currentAlocacaoEtapaId,
    currentInfoEtapaId,
    currentEtapaGroupContext,
    currentInfoEtapaGroupContext,
    activeAlocacaoSortables, activeHotelSortables, activeProjectsSortables,
    ganttSidebarSortable,
    currentTab,
    colaboradorEtapasMap,
    conflictMap,
    obraLabelType,
    zoomLevel,
    zoomLevels,
    lastKnownScrollLeft,
    ganttDragInfo,
    copyModeState,
    unsubscribeNotifications,
    preserveSortOrderOnNextRender,
    currentObraRenderOrder,
    PROCEDIMENTOS_LIST,
    isLoggingEnabled,
    systemLogs,
    projectColors,
    setObrasCollection, setFuncionariosCollection, setEmpresasCollection, setSettingsCollection, setUsersCollection, setUserPreferencesCollection, setNotificacoesCollection,
    setCurrentUser,
    setObras, setFuncionarios, setEmpresas, setUsers, setObraOrder, setActiveProjectIds, setNotificacoes,
    setTempPedidos,
    setGanttExpandedState,
    setSelectedEmpresaId,
    setCurrentAlocacaoEtapaId,
    setCurrentInfoEtapaId,
    setCurrentEtapaGroupContext,
    setCurrentInfoEtapaGroupContext,
    setActiveAlocacaoSortables, setActiveHotelSortables, setActiveProjectsSortables,
    setGanttSidebarSortable,
    setCurrentTab,
    setObraLabelType,
    setZoomLevel,
    setLastKnownScrollLeft,
    setGanttDragInfo,
    setCopyModeState,
    setUnsubscribeNotifications,
    setPreserveSortOrderOnNextRender,
    setCurrentObraRenderOrder,
    setIsLoggingEnabled,
    setSystemLogs
};
