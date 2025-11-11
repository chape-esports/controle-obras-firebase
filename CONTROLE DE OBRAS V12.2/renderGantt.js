import { ganttExpandedState, colaboradorEtapasMap, conflictMap, obraLabelType, zoomLevel, zoomLevels, lastKnownScrollLeft, ganttSidebarSortable, preserveSortOrderOnNextRender, currentObraRenderOrder, obras, activeProjectIds, obraOrder, funcionarios, empresas } from './store.js';
import { getColorForId, diffInDays, getWeekNumber } from './utils.js';
import { getObraSortPriority, getEarliestTaskDateForEmployee } from './businessLogic.js';

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

export { drawGanttGrid, renderGanttChart, renderColaboradorView };
