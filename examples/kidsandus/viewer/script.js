document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const fileNameDisplay = document.getElementById('file-name');
    const mainContent = document.getElementById('main-content');
    const placesList = document.getElementById('places-list');
    const searchInput = document.getElementById('search-places');
    const typeFilterSelect = document.getElementById('filter-type');
    const originFilterSelect = document.getElementById('filter-origin');

    // Views
    const detailsView = document.getElementById('details-view');
    const analyticsView = document.getElementById('analytics-view');
    const sidebar = document.querySelector('.sidebar');

    // View Switcher
    const viewDetailsBtn = document.getElementById('view-details');
    const viewAnalyticsBtn = document.getElementById('view-analytics');

    const serverFilesContainer = document.getElementById('server-files-container');
    const filesList = document.getElementById('files-list');
    const refreshBtn = document.getElementById('refresh-files');

    // Analytics Elements - Vega Containers
    // Note: We select containers by ID to embed charts
    // const topicChartContainer = '#topicChart';
    // const subtopicChartContainer = '#subtopicChart';
    // ...

    const filterInfo = document.getElementById('analytics-filter-info');
    const activeFiltersSpan = document.getElementById('active-filters');
    const clearFiltersBtn = document.getElementById('clear-filters');
    const analyticsDetailsContainer = document.getElementById('analytics-details');
    const filterWithSourcesCheckbox = document.getElementById('filter-with-sources');
    const sourcesStatsSpan = document.getElementById('sources-stats');
    const sourceTypeSelect = document.getElementById('analytics-source-filter');

    let currentData = [];
    let analyticsData = [];
    let originFilteredAnalyticsData = [];
    let currentPromptInputs = [];

    // State
    let activeView = 'details'; // 'details' or 'analytics'
    let selectedTopic = null;
    let selectedSubtopic = null;
    let selectedPlace = null;
    let selectedCompany = null;
    let filterOnlyWithSources = false;
    let selectedDomain = null;
    let analyticsSourceFilter = 'all';
    let searchTerm = '';
    let selectedTypeFilter = 'all';
    let selectedOriginFilter = 'all';
    let filteredPlaces = [];
    let promptMetadataByPlace = new Map();
    let promptMetadataByPrompt = new Map();

    // Chart expansion state - how many items to show
    const MAX_CHART_ITEMS = 10;
    let expandedCharts = {
        topic: false,
        subtopic: false,
        place: false,
        company: false,
        domain: false
    };

    // Vega views storage to finalize/destroy if needed
    const vegaViews = {
        topic: null,
        subtopic: null,
        place: null,
        company: null,
        domain: null
    };

    // Check if running on server and fetch files
    checkServerAndFetchFiles();

    refreshBtn.addEventListener('click', checkServerAndFetchFiles);

    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        fileNameDisplay.textContent = file.name;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                loadData(json);
            } catch (error) {
                console.error('Error parsing JSON:', error);
                alert('Error parsing JSON file.');
            }
        };
        reader.readAsText(file);
    });

    // View Switcher Logic
    viewDetailsBtn.addEventListener('click', () => switchView('details'));
    viewAnalyticsBtn.addEventListener('click', () => switchView('analytics'));

    clearFiltersBtn.addEventListener('click', () => {
        selectedTopic = null;
        selectedSubtopic = null;
        selectedPlace = null;
        selectedCompany = null;
        selectedDomain = null;
        updateAnalyticsView();
    });

    filterWithSourcesCheckbox.addEventListener('change', (e) => {
        filterOnlyWithSources = e.target.checked;
        updateAnalyticsView();
    });

    sourceTypeSelect.addEventListener('change', (e) => {
        analyticsSourceFilter = e.target.value;
        updateAnalyticsView();
    });

    if (typeFilterSelect) {
        typeFilterSelect.addEventListener('change', (e) => {
            updateTypeFilter(e.target.value);
        });
    }

    if (originFilterSelect) {
        originFilterSelect.addEventListener('change', (e) => {
            updateOriginFilter(e.target.value);
        });
    }

    function switchView(view) {
        activeView = view;

        if (view === 'details') {
            detailsView.classList.remove('hidden');
            analyticsView.classList.add('hidden');
            sidebar.classList.remove('hidden');
            viewDetailsBtn.classList.add('active');
            viewAnalyticsBtn.classList.remove('active');
        } else {
            detailsView.classList.add('hidden');
            analyticsView.classList.remove('hidden');
            sidebar.classList.add('hidden');
            viewDetailsBtn.classList.remove('active');
            viewAnalyticsBtn.classList.add('active');

            // Render analytics if data exists
            if (analyticsData.length > 0) {
                updateAnalyticsView();
            }
        }
    }

    async function checkServerAndFetchFiles() {
        try {
            const response = await fetch('/api/files');
            if (response.ok) {
                const files = await response.json();
                renderFilesList(files);
                serverFilesContainer.classList.remove('hidden');
                mainContent.classList.remove('hidden');
            }
        } catch (e) {
            console.log('Server API not available, running in static mode.');
            serverFilesContainer.classList.add('hidden');
        }
    }

    function renderFilesList(files) {
        filesList.innerHTML = '';
        files.forEach(filename => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.textContent = filename;
            li.addEventListener('click', () => loadFileFromServer(filename));
            filesList.appendChild(li);
        });
    }

    async function loadFileFromServer(filename) {
        try {
            const response = await fetch(`/data/${filename}`);
            if (!response.ok) throw new Error('Failed to fetch file');
            const json = await response.json();
            fileNameDisplay.textContent = filename;

            // Highlight active file
            document.querySelectorAll('.file-item').forEach(item => {
                item.classList.toggle('active', item.textContent === filename);
            });

            loadData(json);
        } catch (error) {
            console.error('Error loading file:', error);
            alert('Error loading file from server.');
        }
    }

    function loadData(json) {
        if (json.results && Array.isArray(json.results)) {
            currentPromptInputs = Array.isArray(json.prompt_inputs) ? json.prompt_inputs : [];
            promptMetadataByPlace = new Map();
            promptMetadataByPrompt = new Map();
            currentPromptInputs.forEach(meta => {
                if (meta.place) {
                    promptMetadataByPlace.set(meta.place.toLowerCase(), meta);
                }
                if (meta.prompt) {
                    promptMetadataByPrompt.set(meta.prompt.toLowerCase(), meta);
                }
            });

            currentData = json.results.map(result => ({
                ...result,
                prompt_metadata: resolvePromptMetadata(result)
            }));

            processAnalyticsData(currentData);
            populateMetadataFilters(currentData);
            resetListFilters();
            applyListFilters({ focusFirst: true });
            mainContent.classList.remove('hidden');

            if (activeView === 'analytics' && analyticsData.length > 0) {
                updateAnalyticsView();
            }

        } else {
            alert('Invalid JSON format: Expected a "results" array.');
        }
    }

    // --- Analytics Logic ---

    function updateSourceFilterCounts() {
        if (!sourceTypeSelect) return;
        const totalAll = analyticsData.length;
        const totalSummary = analyticsData.filter(item => item.origin === 'summary').length;
        const totalCompanies = totalAll - totalSummary;
        sourceTypeSelect.options[0].textContent = `Companies + Summary (${totalAll})`;
        sourceTypeSelect.options[1].textContent = `Companies only (${totalCompanies})`;
        sourceTypeSelect.options[2].textContent = `Summary only (${totalSummary})`;
    }

    function matchesOriginFilter(item) {
        if (analyticsSourceFilter === 'companies') {
            return item.origin === 'companies';
        }
        if (analyticsSourceFilter === 'summary') {
            return item.origin === 'summary';
        }
        return true;
    }

    function processAnalyticsData(results) {
        analyticsData = [];

        results.forEach(result => {
            const place = result.place;
            const so = result.structured_output;
            if (!so) return;

            // 1. Companies Mentioned
            if (so.companies_mentioned) {
                so.companies_mentioned.forEach(company => {
                    const companyName = company.company_name;
                    // Get company-level influencing_sources (fallback for statements)
                    const companySources = company.influencing_sources || [];

                    // Pros
                    company.pros.forEach(item => addAnalyticsItem(item, 'pro', place, companyName, companySources, 'companies'));
                    // Cons
                    company.cons.forEach(item => addAnalyticsItem(item, 'con', place, companyName, companySources, 'companies'));
                    // Neutral
                    company.neutral_statements.forEach(item => addAnalyticsItem(item, 'neutral', place, companyName, companySources, 'companies'));
                });
            }

            // 2. Summary Recommendations
            if (so.summary_recommendation) {
                so.summary_recommendation.forEach(rec => {
                    // Criterion itself usually doesn't have a text body, but we can track it if needed.
                    // Usually the recommendations inside have the meat.
                    if (rec.recommendations) {
                        rec.recommendations.forEach(r => {
                            addAnalyticsItem(r, 'recommendation', place, r.company_name || 'General', null, 'summary');
                        });
                    }
                });
            }
        });
    }

    function addAnalyticsItem(item, type, place, company, companySources, origin = 'companies') {
        // Check if item is enriched object or string
        if (typeof item === 'string') return; // Skip raw strings if somehow present

        analyticsData.push({
            place: place,
            company: company,
            type: type,
            text: item.text || item.reason, // 'text' for pros/cons, 'reason' for recommendations
            topic: item.inferred_topic || 'Uncategorized',
            subtopic: item.inferred_subtopic || 'Other',
            // Include sources - from item or fall back to company-level sources
            influencing_sources: item.influencing_sources || companySources || [],
            origin: origin
        });
    }

    function updateAnalyticsView() {
        updateSourceFilterCounts();
        originFilteredAnalyticsData = analyticsData.filter(matchesOriginFilter);

        // Calculate sources stats first (before any filtering)
        const totalItems = originFilteredAnalyticsData.length;
        const itemsWithSources = originFilteredAnalyticsData.filter(item =>
            item.influencing_sources && item.influencing_sources.length > 0
        ).length;
        const percentage = totalItems > 0 ? ((itemsWithSources / totalItems) * 100).toFixed(1) : 0;

        sourcesStatsSpan.innerHTML = `<strong>${itemsWithSources}</strong> of ${totalItems} have sources (<strong>${percentage}%</strong>)`;

        // Filter Data
        const filteredData = originFilteredAnalyticsData.filter(item => {
            if (selectedTopic && item.topic !== selectedTopic) return false;
            if (selectedSubtopic && item.subtopic !== selectedSubtopic) return false;
            if (selectedPlace && item.place !== selectedPlace) return false;
            if (selectedCompany && item.company !== selectedCompany) return false;
            // Filter by sources if enabled
            if (filterOnlyWithSources && (!item.influencing_sources || item.influencing_sources.length === 0)) return false;
            // Filter by domain
            if (selectedDomain) {
                const hasMatchingDomain = item.influencing_sources &&
                    item.influencing_sources.some(src => src.domain === selectedDomain);
                if (!hasMatchingDomain) return false;
            }
            return true;
        });

        // Update Charts
        updateCharts(filteredData);

        // Update Details List
        renderAnalyticsDetails(filteredData);

        // Update Filter Info UI
        if (selectedTopic || selectedSubtopic || selectedPlace || selectedCompany) {
            filterInfo.classList.remove('hidden');
            let text = [];
            if (selectedTopic) text.push(`Topic: <strong>${selectedTopic}</strong>`);
            if (selectedSubtopic) text.push(`Subtopic: <strong>${selectedSubtopic}</strong>`);
            if (selectedPlace) text.push(`Place: <strong>${selectedPlace}</strong>`);
            if (selectedCompany) text.push(`Company: <strong>${selectedCompany}</strong>`);
            activeFiltersSpan.innerHTML = text.join(' & ');
        } else {
            filterInfo.classList.add('hidden');
        }
    }

    function updateCharts(data) {
        // --- Cross-Filtering Logic ---
        // Each chart shows the distribution of available data *given the OTHER filters*,
        // but should probably NOT be filtered by itself (to allow changing selection easily).
        // However, standard behavior usually filters everything down. 
        // Let's stick to: Filter by EVERYTHING EXCEPT self (if selected).

        const baseData = originFilteredAnalyticsData;

        const getFilteredDataFor = (ignoreKey, ignoreValue) => {
            return baseData.filter(item => {
                // Apply "Only with sources" filter to all charts
                if (filterOnlyWithSources && (!item.influencing_sources || item.influencing_sources.length === 0)) return false;

                if (selectedTopic && ignoreKey !== 'topic' && item.topic !== selectedTopic) return false;
                if (selectedSubtopic && ignoreKey !== 'subtopic' && item.subtopic !== selectedSubtopic) return false;
                if (selectedPlace && ignoreKey !== 'place' && item.place !== selectedPlace) return false;
                if (selectedCompany && ignoreKey !== 'company' && item.company !== selectedCompany) return false;
                // Include domain filter for crossfilter behavior
                if (selectedDomain && ignoreKey !== 'domain') {
                    const hasMatchingDomain = item.influencing_sources &&
                        item.influencing_sources.some(src => src.domain === selectedDomain);
                    if (!hasMatchingDomain) return false;
                }
                return true;
            });
        };

        // 1. Topic Data
        const dataForTopics = getFilteredDataFor('topic', selectedTopic);
        const topicCounts = {};
        dataForTopics.forEach(item => topicCounts[item.topic] = (topicCounts[item.topic] || 0) + 1);

        // 2. Subtopic Data
        const dataForSubtopics = getFilteredDataFor('subtopic', selectedSubtopic);
        const subtopicCounts = {};
        dataForSubtopics.forEach(item => subtopicCounts[item.subtopic] = (subtopicCounts[item.subtopic] || 0) + 1);

        // 3. Place Data
        const dataForPlaces = getFilteredDataFor('place', selectedPlace);
        const placeCounts = {};
        dataForPlaces.forEach(item => placeCounts[item.place] = (placeCounts[item.place] || 0) + 1);

        // 4. Company Data
        const dataForCompanies = getFilteredDataFor('company', selectedCompany);
        const companyCounts = {};
        dataForCompanies.forEach(item => companyCounts[item.company] = (companyCounts[item.company] || 0) + 1);

        // 5. Domain Data (for crossfilter chart)
        const dataForDomains = getFilteredDataFor('domain', selectedDomain);
        const domainCountsForChart = {};
        dataForDomains.forEach(item => {
            if (item.influencing_sources && item.influencing_sources.length > 0) {
                item.influencing_sources.forEach(src => {
                    if (src.domain) {
                        domainCountsForChart[src.domain] = (domainCountsForChart[src.domain] || 0) + 1;
                    }
                });
            }
        });

        renderVegaChart('#topicChart', 'topic', topicCounts, selectedTopic, '#2563eb', '#93c5fd', 'vertical');
        renderVegaChart('#subtopicChart', 'subtopic', subtopicCounts, selectedSubtopic, '#db2777', '#f9a8d4', 'vertical');
        renderVegaChart('#placeChart', 'place', placeCounts, selectedPlace, '#16a34a', '#86efac', 'horizontal');
        renderVegaChart('#companyChart', 'company', companyCounts, selectedCompany, '#ea580c', '#fdba74', 'horizontal');
        renderVegaChart('#domainChart', 'domain', domainCountsForChart, selectedDomain, '#0ea5e9', '#7dd3fc', 'horizontal');
    }

    async function renderVegaChart(containerSelector, chartType, counts, selectedValue, activeColor, defaultColor, orientation) {
        const data = Object.entries(counts)
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => b.count - a.count);

        const totalCount = data.length;
        const isExpanded = expandedCharts[chartType];
        const displayData = isExpanded ? data : data.slice(0, MAX_CHART_ITEMS);

        // Dimensions for "Show all" scroll
        const STEP_SIZE_X = 40; 
        const STEP_SIZE_Y = 30;
        
        let width, height;
        
        if (orientation === 'vertical') {
            height = 300;
            width = isExpanded ? Math.max(displayData.length * STEP_SIZE_X, 300) : "container"; 
        } else {
            width = "container";
            height = isExpanded ? Math.max(displayData.length * STEP_SIZE_Y, 300) : 300;
        }

        const spec = {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            data: { values: displayData },
            width: width,
            height: height,
            autosize: { type: "fit", contains: "padding" },
            mark: { type: "bar", cornerRadiusEnd: 4, tooltip: true },
            encoding: {
                [orientation === 'vertical' ? 'x' : 'y']: {
                    field: "label",
                    type: "nominal",
                    sort: null, // Already sorted
                    axis: { 
                        labelAngle: orientation === 'vertical' ? -45 : 0,
                        title: null,
                        labelLimit: 150
                    }
                },
                [orientation === 'vertical' ? 'y' : 'x']: {
                    field: "count",
                    type: "quantitative",
                    title: null
                },
                color: {
                    condition: {
                        test: `datum.label === '${selectedValue || ''}'`,
                        value: activeColor
                    },
                    value: defaultColor
                },
                tooltip: [
                    { field: "label", title: chartType.charAt(0).toUpperCase() + chartType.slice(1) },
                    { field: "count", title: "Count" }
                ]
            },
            config: {
                view: { stroke: "transparent" } // Remove chart border
            }
        };

        // Destroy previous view if exists to prevent memory leaks, although vegaEmbed handles replacement
        if (vegaViews[chartType]) {
            vegaViews[chartType].finalize();
        }

        try {
            // Note: vegaEmbed replaces the content of the container
            const result = await vegaEmbed(containerSelector, spec, { actions: false, renderer: 'svg' });
            vegaViews[chartType] = result.view;

            // Add click listener
            result.view.addEventListener('click', (event, item) => {
                if (item && item.datum) {
                    const clickedLabel = item.datum.label;
                    
                    // Update state
                    if (chartType === 'topic') selectedTopic = selectedTopic === clickedLabel ? null : clickedLabel;
                    if (chartType === 'subtopic') selectedSubtopic = selectedSubtopic === clickedLabel ? null : clickedLabel;
                    if (chartType === 'place') selectedPlace = selectedPlace === clickedLabel ? null : clickedLabel;
                    if (chartType === 'company') selectedCompany = selectedCompany === clickedLabel ? null : clickedLabel;
                    if (chartType === 'domain') selectedDomain = selectedDomain === clickedLabel ? null : clickedLabel;

                        updateAnalyticsView();
                    }
            });

            updateExpandButton(chartType, totalCount);

        } catch (error) {
            console.error(`Error rendering Vega chart ${chartType}:`, error);
        }
    }

    // Helper to update expand/collapse button
    function updateExpandButton(chartType, totalCount) {
        const btnId = `expand-${chartType}`;
        let btn = document.getElementById(btnId);
        const wrapper = document.querySelector(`[data-chart="${chartType}"]`);

        if (!btn && wrapper) {
            btn = document.createElement('button');
            btn.id = btnId;
            btn.className = 'chart-expand-btn';
            btn.addEventListener('click', () => toggleChartExpansion(chartType));
            wrapper.appendChild(btn);
        }

        if (btn) {
            const isExpanded = expandedCharts[chartType];
            const hiddenCount = totalCount - MAX_CHART_ITEMS;
            
            if (totalCount <= MAX_CHART_ITEMS) {
                btn.style.display = 'none';
            } else {
                btn.style.display = 'block';
                btn.textContent = isExpanded 
                    ? `Show less ↑` 
                    : `Show all ${totalCount} (+${hiddenCount} more)`;
                btn.classList.toggle('expanded', isExpanded);
            }
        }
    }

    function toggleChartExpansion(chartType) {
        expandedCharts[chartType] = !expandedCharts[chartType];
        
        // Toggle expanded class on wrapper for CSS styling
        const wrapper = document.querySelector(`[data-chart="${chartType}"]`);
        if (wrapper) {
            wrapper.classList.toggle('expanded', expandedCharts[chartType]);
        }
        
        // Re-render all charts to apply the new expansion state
                        updateAnalyticsView();
    }

    function renderAnalyticsDetails(data) {
        analyticsDetailsContainer.innerHTML = '';

        // Limit to first 100 items to prevent DOM explosion
        const displayData = data.slice(0, 100);

        if (data.length === 0) {
            analyticsDetailsContainer.innerHTML = '<p class="empty-state">No matching statements found.</p>';
            return;
        }

        displayData.forEach(item => {
            const el = document.createElement('div');
            el.className = `analysis-item analysis-type-${item.type}`;

            const topicBadge = `<span class="topic-badge">${item.topic}</span>`;
            const subtopicBadge = `<span class="subtopic-badge">${item.subtopic}</span>`;
            const originLabel = item.origin === 'summary' ? 'Summary recommendation' : 'Company insight';
            const originClass = item.origin === 'summary' ? 'analysis-origin analysis-origin-summary' : 'analysis-origin analysis-origin-company';

            // Build sources HTML if available - include citation numbers from positions
            let sourcesHtml = '';
            if (item.influencing_sources && item.influencing_sources.length > 0) {
                const sourceLinks = item.influencing_sources.map(src => {
                    // Show citation numbers if available
                    const positionBadges = src.positions && src.positions.length > 0
                        ? src.positions.map(p => `<span class="citation-badge-small">[${p}]</span>`).join('')
                        : '';
                    return `<span class="source-chip-wrapper">
                        ${positionBadges}
                        <a href="${src.url}" target="_blank" class="source-chip-link" title="Open: ${src.title || src.url}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                        </a>
                        <button class="source-chip-filter ${selectedDomain === src.domain ? 'active' : ''}" data-domain="${src.domain}" title="Filter by ${src.domain}">
                            ${src.domain}
                        </button>
                    </span>`;
                }).join('');
                sourcesHtml = `<div class="analysis-sources">${sourceLinks}</div>`;
            }

            el.innerHTML = `
                <div class="analysis-header">
                    <div class="analysis-header-left">
                        <div class="analysis-company-row">
                            <span class="analysis-company-name">${item.company || 'General'}</span>
                            <span class="${originClass}">${originLabel}</span>
                        </div>
                        <div class="analysis-meta-row">
                            <span class="analysis-place-pill">${item.place}</span>
                        </div>
                    </div>
                    <div class="analysis-header-actions">
                        <button class="goto-details-btn" title="View details" data-place="${item.place}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        </button>
                    </div>
                </div>
                <div class="analysis-text">${item.text}</div>
                <div class="analysis-footer">
                    ${topicBadge}
                    ${subtopicBadge}
                </div>
                ${sourcesHtml}
            `;

            // Add click listener to the details button
            const btn = el.querySelector('.goto-details-btn');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigateToDetails(item.place);
            });

            // Add click listeners to domain filter buttons
            const domainBtns = el.querySelectorAll('.source-chip-filter');
            domainBtns.forEach(domainBtn => {
                domainBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const domain = domainBtn.dataset.domain;
                    selectedDomain = selectedDomain === domain ? null : domain;
                    updateAnalyticsView();
                });
            });

            analyticsDetailsContainer.appendChild(el);
        });

        if (data.length > 100) {
            const more = document.createElement('div');
            more.style.textAlign = 'center';
            more.style.gridColumn = '1 / -1';
            more.style.padding = '1rem';
            more.style.color = 'var(--text-secondary)';
            more.textContent = `...and ${data.length - 100} more items`;
            analyticsDetailsContainer.appendChild(more);
        }
    }

    function navigateToDetails(placeName) {
        // 1. Find the item in currentData
        const item = currentData.find(d => d.place === placeName);
        if (!item) {
            console.warn('Place not found in data:', placeName);
            return;
        }

        // 2. Switch View
        switchView('details');

        // 3. Select and Render
        renderDetails(item);
        highlightActivePlace(placeName);

        // 4. Scroll place into view in the sidebar
        const placeEl = document.querySelector(`.place-item[data-place="${placeName}"]`);
        if (placeEl) {
            placeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }


    // --- Existing Details View Logic ---

    searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        applyListFilters();
    });

    function renderPlacesList(data) {
        placesList.innerHTML = '';
        if (!data || data.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'places-empty';
            empty.textContent = 'No places match the current filters';
            placesList.appendChild(empty);
            return;
        }

        data.forEach(item => {
            const li = document.createElement('li');
            li.className = 'place-item';
            li.textContent = item.place || 'Unknown Place';
            li.dataset.place = item.place;
            li.addEventListener('click', () => {
                renderDetails(item);
                highlightActivePlace(item.place);
            });
            placesList.appendChild(li);
        });

        highlightActivePlace(selectedPlace);
    }

    function matchesListFilters(item) {
        if (!item) return false;
        const meta = item.prompt_metadata || resolvePromptMetadata(item);
        const matchesType = selectedTypeFilter === 'all' || (meta && meta.type === selectedTypeFilter);
        const matchesOrigin = selectedOriginFilter === 'all' || (meta && meta.originalPlace === selectedOriginFilter);
        const matchesSearch = !searchTerm ||
            (item.place && item.place.toLowerCase().includes(searchTerm)) ||
            (item.prompt && item.prompt.toLowerCase().includes(searchTerm));
        return matchesType && matchesOrigin && matchesSearch;
    }

    function applyListFilters(options = {}) {
        const { focusFirst = false } = options;
        if (!Array.isArray(currentData)) {
            return;
        }
        filteredPlaces = currentData.filter(matchesListFilters);
        renderPlacesList(filteredPlaces);
        if (focusFirst && filteredPlaces.length > 0) {
            renderDetails(filteredPlaces[0]);
            highlightActivePlace(filteredPlaces[0].place);
        }
    }

    function populateMetadataFilters(data) {
        if (!typeFilterSelect || !originFilterSelect) return;
        const types = new Set();
        const origins = new Set();

        data.forEach(item => {
            const meta = item.prompt_metadata || resolvePromptMetadata(item);
            if (meta?.type) {
                types.add(meta.type);
            }
            if (meta?.originalPlace) {
                origins.add(meta.originalPlace);
            }
        });

        setSelectOptions(typeFilterSelect, Array.from(types), 'All types');
        setSelectOptions(originFilterSelect, Array.from(origins), 'All origins');
    }

    function setSelectOptions(selectEl, values, defaultLabel) {
        selectEl.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = 'all';
        defaultOption.textContent = defaultLabel;
        selectEl.appendChild(defaultOption);

        values
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            .forEach(value => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = value;
                selectEl.appendChild(option);
            });

        selectEl.value = 'all';
    }

    function resetListFilters() {
        searchTerm = '';
        selectedTypeFilter = 'all';
        selectedOriginFilter = 'all';
        if (searchInput) {
            searchInput.value = '';
        }
        if (typeFilterSelect) {
            typeFilterSelect.value = 'all';
        }
        if (originFilterSelect) {
            originFilterSelect.value = 'all';
        }
    }

    function resolvePromptMetadata(item) {
        if (item.prompt_metadata) {
            return item.prompt_metadata;
        }
        if (item.place) {
            const byPlace = promptMetadataByPlace.get(item.place.toLowerCase());
            if (byPlace) {
                return byPlace;
            }
        }
        if (item.prompt) {
            const byPrompt = promptMetadataByPrompt.get(item.prompt.toLowerCase());
            if (byPrompt) {
                return byPrompt;
            }
        }
        return null;
    }

    function updateTypeFilter(value, options = {}) {
        selectedTypeFilter = value || 'all';
        if (typeFilterSelect) {
            const hasOption = Array.from(typeFilterSelect.options).some(opt => opt.value === selectedTypeFilter);
            typeFilterSelect.value = hasOption ? selectedTypeFilter : 'all';
            if (!hasOption) {
                selectedTypeFilter = 'all';
            }
        }
        applyListFilters(options);
    }

    function updateOriginFilter(value, options = {}) {
        selectedOriginFilter = value || 'all';
        if (originFilterSelect) {
            const hasOption = Array.from(originFilterSelect.options).some(opt => opt.value === selectedOriginFilter);
            originFilterSelect.value = hasOption ? selectedOriginFilter : 'all';
            if (!hasOption) {
                selectedOriginFilter = 'all';
            }
        }
        applyListFilters(options);
    }

    function createFilterChip(label, onClick) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'filter-chip';
        chip.textContent = label;
        chip.addEventListener('click', onClick);
        return chip;
    }

    function highlightActivePlace(placeName) {
        document.querySelectorAll('.place-item').forEach(item => {
            if (item.dataset.place === placeName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    function renderDetails(item) {
        // Clear previous content
        detailsView.innerHTML = '';
        selectedPlace = item.place || null;

        const promptMetadata = item.prompt_metadata || resolvePromptMetadata(item);
        if (promptMetadata && !item.prompt_metadata) {
            item.prompt_metadata = promptMetadata;
        }

        const container = document.createElement('div');
        container.className = 'result-container';

        // 1. Meta Info
        const metaCard = document.createElement('div');
        metaCard.className = 'section-card';
        metaCard.innerHTML = `
            <h3 class="section-title">Metadata</h3>
            <div class="meta-grid">
                <div class="meta-item">
                    <span class="meta-label">Place</span>
                    <span class="meta-value">${item.place || 'N/A'}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Prompt</span>
                    <span class="meta-value">${item.prompt || promptMetadata?.prompt || 'N/A'}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Prompt Type</span>
                    <span class="meta-value">${promptMetadata?.type || 'N/A'}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Original Place</span>
                    <span class="meta-value">${promptMetadata?.originalPlace || 'N/A'}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Origin ID</span>
                    <span class="meta-value">${promptMetadata?.originId || 'N/A'}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Model</span>
                    <span class="meta-value">${item.structured_output?.model_used || 'N/A'}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Timestamp</span>
                    <span class="meta-value">${item.structured_output?.timestamp_utc || 'N/A'}</span>
                </div>
            </div>
        `;

        if (promptMetadata && (promptMetadata.type || promptMetadata.originalPlace)) {
            const metadataFilters = document.createElement('div');
            metadataFilters.className = 'meta-filters';
            if (promptMetadata.type) {
                metadataFilters.appendChild(
                    createFilterChip(`Type: ${promptMetadata.type}`, () => {
                        updateTypeFilter(promptMetadata.type, { focusFirst: true });
                    })
                );
            }
            if (promptMetadata.originalPlace) {
                metadataFilters.appendChild(
                    createFilterChip(`Original: ${promptMetadata.originalPlace}`, () => {
                        updateOriginFilter(promptMetadata.originalPlace, { focusFirst: true });
                    })
                );
            }
            metaCard.appendChild(metadataFilters);
        }
        container.appendChild(metaCard);

        // 2. Search Queries
        if (item.searchQueries && item.searchQueries.length > 0) {
            const queriesCard = document.createElement('div');
            queriesCard.className = 'section-card';
            queriesCard.innerHTML = `
                <h3 class="section-title">Search Queries</h3>
                <div class="tag-list">
                    ${item.searchQueries.map(q => `<span class="tag">${q}</span>`).join('')}
                </div>
            `;
            container.appendChild(queriesCard);
        }

        // 2. Answer (Markdown)
        const answerCard = document.createElement('div');
        answerCard.className = 'section-card';
        const answerHtml = marked.parse(item.answer || '*No answer provided*');
        answerCard.innerHTML = `
            <h3 class="section-title">Generated Answer</h3>
            <div class="markdown-body">${answerHtml}</div>
        `;
        container.appendChild(answerCard);

        // 3. Structured Output (Companies)
        if (item.structured_output && item.structured_output.companies_mentioned) {
            const companiesCard = document.createElement('div');
            companiesCard.className = 'section-card';
            companiesCard.innerHTML = `<h3 class="section-title">Companies Mentioned</h3>`;

            item.structured_output.companies_mentioned.forEach(company => {
                const card = document.createElement('div');
                card.className = 'company-card';

                let prosHtml = company.pros.map(p => `<li>${renderTextWithTopic(p)}</li>`).join('');
                let consHtml = company.cons.map(c => `<li>${renderTextWithTopic(c)}</li>`).join('');
                let neutralHtml = company.neutral_statements.map(n => `<li>${renderTextWithTopic(n)}</li>`).join('');

                card.innerHTML = `
                    <div class="company-header">
                        <span class="company-name">${company.company_name}</span>
                        <span class="rank-badge">Rank: ${company.mention_rank_position}</span>
                    </div>
                    ${prosHtml ? `<div class="list-group"><div class="list-title">Pros</div><ul class="pros-list">${prosHtml}</ul></div>` : ''}
                    ${consHtml ? `<div class="list-group"><div class="list-title">Cons</div><ul class="cons-list">${consHtml}</ul></div>` : ''}
                    ${neutralHtml ? `<div class="list-group"><div class="list-title">Neutral</div><ul class="neutral-list">${neutralHtml}</ul></div>` : ''}
                `;
                companiesCard.appendChild(card);
            });
            container.appendChild(companiesCard);
        }

        // 4. Summary Recommendations
        if (item.structured_output && item.structured_output.summary_recommendation) {
            const recCard = document.createElement('div');
            recCard.className = 'section-card';
            recCard.innerHTML = `<h3 class="section-title">Summary Recommendations</h3>`;

            const ul = document.createElement('ul');
            ul.style.listStyle = 'none';

            item.structured_output.summary_recommendation.forEach(rec => {
                const li = document.createElement('li');
                li.style.marginBottom = '1rem';

                // Handle enriched criterion
                let criterionHtml = `<strong>${rec.criterion}</strong>`;
                if (rec.inferred_topic) {
                    criterionHtml += ` <span class="topic-badge">${rec.inferred_topic}</span>`;
                }
                if (rec.inferred_subtopic) {
                    criterionHtml += ` <span class="subtopic-badge">${rec.inferred_subtopic}</span>`;
                }

                li.innerHTML = criterionHtml;

                if (rec.recommendations && rec.recommendations.length > 0) {
                    const subUl = document.createElement('ul');
                    rec.recommendations.forEach(r => {
                        const subLi = document.createElement('li');
                        let reasonHtml = `${r.company_name ? `<strong>${r.company_name}</strong>: ` : ''}${r.reason}`;

                        if (r.inferred_topic) {
                            reasonHtml += ` <span class="topic-badge">${r.inferred_topic}</span>`;
                        }
                        if (r.inferred_subtopic) {
                            reasonHtml += ` <span class="subtopic-badge">${r.inferred_subtopic}</span>`;
                        }

                        subLi.innerHTML = reasonHtml;
                        subUl.appendChild(subLi);
                    });
                    li.appendChild(subUl);
                }
                ul.appendChild(li);
            });
            recCard.appendChild(ul);
            container.appendChild(recCard);
        }

        // 6. Sources
        const sourcesMap = new Map();

        // Process 'sources' (from citation) - use positions field for citation numbers
        if (item.sources && Array.isArray(item.sources)) {
            item.sources.forEach(s => {
                // Use positions array if available, otherwise empty
                const positions = s.positions && s.positions.length > 0 ? s.positions : [];
                sourcesMap.set(s.url, { ...s, origin: 'source', positions });
            });
        }

        // Process 'searchSources' (from search results)
        if (item.searchSources && Array.isArray(item.searchSources)) {
            item.searchSources.forEach(s => {
                if (sourcesMap.has(s.url)) {
                    const existing = sourcesMap.get(s.url);
                    sourcesMap.set(s.url, { ...existing, ...s, origin: 'both' });
                } else {
                    sourcesMap.set(s.url, { ...s, origin: 'search', positions: [] });
                }
            });
        }

        if (sourcesMap.size > 0) {
            const sourcesCard = document.createElement('div');
            sourcesCard.className = 'section-card';
            sourcesCard.innerHTML = `<h3 class="section-title">Sources - ${sourcesMap.size} links checked</h3>`;

            // Sort: sources with positions first (by lowest position), then search-only sources
            const sortedSources = Array.from(sourcesMap.values()).sort((a, b) => {
                const aMin = a.positions && a.positions.length > 0 ? Math.min(...a.positions) : Infinity;
                const bMin = b.positions && b.positions.length > 0 ? Math.min(...b.positions) : Infinity;
                return aMin - bMin;
            });

            sortedSources.forEach(source => {
                const link = document.createElement('a');
                link.className = 'source-link';
                link.href = source.url;
                link.target = '_blank';

                let badgeClass = '';
                let badgeText = '';

                if (source.origin === 'both') {
                    badgeClass = 'badge-both';
                    badgeText = 'Source & Search';
                } else if (source.origin === 'source') {
                    badgeClass = 'badge-source';
                    badgeText = 'Source Only';
                } else {
                    badgeClass = 'badge-search';
                    badgeText = 'Search Only';
                }

                // Citation number badges (from positions array)
                const citationBadge = source.positions && source.positions.length > 0
                    ? source.positions.map(p => `<span class="citation-badge">[${p}]</span>`).join('')
                    : '';

                link.innerHTML = `
                    <div class="source-inner">
                        <div class="source-content">
                            ${citationBadge}
                            <div class="source-text">
                            <span class="source-title">${source.title || 'Untitled'}</span>
                            <span class="source-url">${source.url}</span>
                            </div>
                        </div>
                        <span class="origin-badge ${badgeClass}">${badgeText}</span>
                    </div>
                `;
                sourcesCard.appendChild(link);
            });
            container.appendChild(sourcesCard);
        }

        detailsView.appendChild(container);
    }

    // Helper function to render text with topic badges and sources
    function renderTextWithTopic(item) {
        if (typeof item === 'string') return item;
        if (!item) return '';

        // Build sources HTML if available - include citation numbers from positions
        let sourcesHtml = '';
        if (item.influencing_sources && item.influencing_sources.length > 0) {
            const sourceLinks = item.influencing_sources.map(src => {
                const positionBadges = src.positions && src.positions.length > 0
                    ? src.positions.map(p => `[${p}]`).join('')
                    : '';
                return `<a href="${src.url}" target="_blank" class="source-chip-small" title="${src.title || src.url}">${positionBadges} 🔗 ${src.domain}</a>`;
            }).join(' ');
            sourcesHtml = `<div class="inline-sources">${sourceLinks}</div>`;
        }

        // It's an object { text, inferred_topic, inferred_subtopic, influencing_sources }
        return `
            ${item.text}
            <span class="topic-badge" title="Topic">${item.inferred_topic}</span>
            <span class="subtopic-badge" title="Subtopic">${item.inferred_subtopic}</span>
            ${sourcesHtml}
        `;
    }
});
