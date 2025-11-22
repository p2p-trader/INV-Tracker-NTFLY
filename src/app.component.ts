import { Component, ChangeDetectionStrategy, signal, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InventoryService } from './services/inventory.service';
import { MaterialSummary, InventoryResponse, Transaction, DashboardTransaction } from './models/inventory.model';
import { costCenterMap } from './data/cost-centers';

type SortableColumns = 'materialDescription' | 'balance';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule],
  host: {
    '(window:keydown.escape)': 'handleEscapeKey()'
  }
})
export class AppComponent {
  private inventoryService = inject(InventoryService);

  // Core State
  inventoryData = signal<MaterialSummary[]>([]);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);
  lastUpdated = signal<Date | null>(null);

  // UI State
  theme = signal<'light' | 'dark'>('light');

  // Filtering and Sorting State
  searchTerm = signal<string>('');
  movementTypeFilter = signal<'all' | '101' | '201'>('all');
  sortConfig = signal<{ column: SortableColumns, direction: 'asc' | 'desc' }>({ column: 'materialDescription', direction: 'asc' });
  showLowStockOnly = signal<boolean>(false);

  // Pagination State
  currentPage = signal(1);
  itemsPerPage = 12;
  lowStockThreshold = 10;
  
  // Modal State
  selectedMaterial = signal<MaterialSummary | null>(null);
  detailedViewType = signal<'in' | 'out' | null>(null);
  dateFrom = signal<string>('');
  dateTo = signal<string>('');
  dashboardFilters = signal({
    date: '',
    movement: 'all' as 'all' | 'in' | 'out',
    user: '',
    costCenter: '',
    details: ''
  });

  // === Computed Signals for Data Flow ===

  private baseFilteredInventory = computed(() => {
    const data = this.inventoryData();
    const term = this.searchTerm().toLowerCase();
    const filter = this.movementTypeFilter();
    const lowStockOnly = this.showLowStockOnly();

    let filteredData = data;

    if (lowStockOnly) {
      filteredData = filteredData.filter(item => item.balance <= this.lowStockThreshold);
    }
    
    if (filter === '101') {
      filteredData = filteredData.filter(item => item.totalIn > 0);
    } else if (filter === '201') {
      filteredData = filteredData.filter(item => item.totalOut > 0);
    }

    if (!term) return filteredData;
    
    return filteredData.filter(item =>
      item.material.toLowerCase().includes(term) ||
      item.materialDescription.toLowerCase().includes(term)
    );
  });
  
  private sortedInventory = computed(() => {
    const data = [...this.baseFilteredInventory()];
    const config = this.sortConfig();
    
    data.sort((a, b) => {
      const aValue = a[config.column];
      const bValue = b[config.column];
      
      let comparison = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue);
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      }

      return config.direction === 'asc' ? comparison : -comparison;
    });

    return data;
  });

  paginatedInventory = computed(() => {
    const data = this.sortedInventory();
    const page = this.currentPage();
    const startIndex = (page - 1) * this.itemsPerPage;
    return data.slice(startIndex, startIndex + this.itemsPerPage);
  });

  totalPages = computed(() => {
    return Math.ceil(this.baseFilteredInventory().length / this.itemsPerPage);
  });

  inventoryStats = computed(() => {
    const data = this.inventoryData();
    return {
      totalItems: data.length,
      totalReceived: data.reduce((acc, item) => acc + item.totalIn, 0),
      totalIssued: data.reduce((acc, item) => acc + item.totalOut, 0)
    };
  });
  
  itemDashboard = computed(() => {
    const material = this.selectedMaterial();
    if (!material) return null;

    const inTxs: DashboardTransaction[] = material.inTransactions.map(t => ({ ...t, type: 'in' as const }));
    const outTxs: DashboardTransaction[] = material.outTransactions.map(t => ({ ...t, type: 'out' as const }));

    let allTransactions = [...inTxs, ...outTxs].sort((a, b) => 
      new Date(b.postingDate).getTime() - new Date(a.postingDate).getTime()
    );

    const filters = this.dashboardFilters();
    const fDate = filters.date.toLowerCase();
    const fUser = filters.user.toLowerCase();
    const fCostCenter = filters.costCenter.toLowerCase();
    const fDetails = filters.details.toLowerCase();

    if (filters.movement !== 'all') {
      allTransactions = allTransactions.filter(tx => tx.type === filters.movement);
    }
    if (fDate) {
      const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
      allTransactions = allTransactions.filter(tx => 
          dateFormatter.format(new Date(tx.postingDate)).toLowerCase().includes(fDate)
      );
    }
    if (fUser) {
        allTransactions = allTransactions.filter(tx => (tx.user || '').toLowerCase().includes(fUser));
    }
    if (fCostCenter) {
        allTransactions = allTransactions.filter(tx => (tx.costCenter || '').toLowerCase().includes(fCostCenter));
    }
    if (fDetails) {
        allTransactions = allTransactions.filter(tx => 
            (tx.headerText || '').toLowerCase().includes(fDetails) ||
            (tx.text || '').toLowerCase().includes(fDetails) ||
            (tx.document || '').toLowerCase().includes(fDetails) ||
            (tx.reservation || '').toLowerCase().includes(fDetails)
        );
    }

    return { ...material, allTransactions };
  });

  detailedTransactionsView = computed(() => {
    const type = this.detailedViewType();
    const material = this.selectedMaterial();
    if (!type || !material) return null;

    const from = this.dateFrom() ? new Date(this.dateFrom()) : null;
    const to = this.dateTo() ? new Date(this.dateTo()) : null;
    
    if (to) to.setHours(23, 59, 59, 999);
    if (from) from.setHours(0, 0, 0, 0);

    const transactions = type === 'in' ? material.inTransactions : material.outTransactions;
    
    const filteredTransactions = transactions.filter(tx => {
      const txDate = new Date(tx.postingDate);
      if (from && txDate < from) return false;
      if (to && txDate > to) return false;
      return true;
    });

    const totalQuantity = filteredTransactions.reduce((sum, tx) => sum + tx.quantity, 0);

    return {
      type,
      title: type === 'in' ? 'Receipt Details' : 'Issue Details',
      transactions: filteredTransactions,
      totalQuantity
    };
  });

  constructor() {
    this.initializeTheme();
    this.loadInventory();

    // Effect to update the DOM when theme changes
    effect(() => {
      const currentTheme = this.theme();
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(currentTheme);
      localStorage.setItem('inventory-theme', currentTheme);
    });
  }

  // === Core Data Handling ===
  loadInventory(): void {
    this.loading.set(true);
    this.error.set(null);
    this.inventoryService.getInventoryData().subscribe({
      next: (response) => {
        try {
          const processedData = this.processData(response);
          this.inventoryData.set(processedData);
          this.lastUpdated.set(new Date());
        } catch (e: any) {
          this.error.set(e.message);
        } finally {
          this.loading.set(false);
        }
      },
      error: (err) => {
        this.error.set(err.message || 'An unknown error occurred.');
        this.loading.set(false);
      }
    });
  }

  // === Event Handlers ===
  onSearch(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
    this.currentPage.set(1);
  }
  
  onMovementTypeChange(event: Event): void {
    this.movementTypeFilter.set((event.target as HTMLSelectElement).value as 'all' | '101' | '201');
    this.currentPage.set(1);
  }

  onSortChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const [column, direction] = value.split('-') as [SortableColumns, 'asc' | 'desc'];
    this.sortConfig.set({ column, direction });
    this.currentPage.set(1);
  }

  onShowLowStockOnlyChange(event: Event): void {
    this.showLowStockOnly.set((event.target as HTMLInputElement).checked);
    this.currentPage.set(1);
  }

  onDashboardFilterChange(event: Event, field: keyof ReturnType<typeof this.dashboardFilters>): void {
    const value = (event.target as HTMLInputElement).value;
    this.dashboardFilters.update(filters => ({ ...filters, [field]: value }));
  }

  // === Modal Management ===
  showItemDashboard(material: MaterialSummary): void { this.selectedMaterial.set(material); }
  
  closeDashboard(): void { 
    this.selectedMaterial.set(null); 
    this.closeDetailedView();
    this.resetDashboardFilters();
  }

  resetDashboardFilters(): void {
    this.dashboardFilters.set({
        date: '',
        movement: 'all',
        user: '',
        costCenter: '',
        details: ''
    });
  }

  showDetailedView(type: 'in' | 'out'): void {
    const material = this.selectedMaterial();
    if (!material) return;
    const transactions = type === 'in' ? material.inTransactions : material.outTransactions;
    if (transactions.length === 0) return;

    const today = new Date();
    const oldestTxDate = new Date(transactions[transactions.length - 1].postingDate); 
    this.dateTo.set(today.toISOString().split('T')[0]);
    this.dateFrom.set(oldestTxDate.toISOString().split('T')[0]);
    this.detailedViewType.set(type);
  }

  closeDetailedView(): void {
    this.detailedViewType.set(null);
    this.dateFrom.set('');
    this.dateTo.set('');
  }
  
  handleEscapeKey(): void {
    if (this.detailedViewType()) {
      this.closeDetailedView();
    } else if (this.selectedMaterial()) {
      this.closeDashboard();
    }
  }

  // === Pagination Handlers ===
  goToPage(page: number): void { if (page > 0 && page <= this.totalPages()) this.currentPage.set(page); }
  nextPage(): void { this.goToPage(this.currentPage() + 1); }
  prevPage(): void { this.goToPage(this.currentPage() - 1); }

  // === Other UI Logic ===
  onDateChange(event: Event, type: 'from' | 'to'): void {
    const value = (event.target as HTMLInputElement).value;
    if (type === 'from') this.dateFrom.set(value);
    else this.dateTo.set(value);
  }

  toggleTheme(): void {
    this.theme.update(current => current === 'light' ? 'dark' : 'light');
  }

  private initializeTheme(): void {
    const storedTheme = localStorage.getItem('inventory-theme');
    if (storedTheme === 'dark' || storedTheme === 'light') {
      this.theme.set(storedTheme);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      this.theme.set('dark');
    }
  }
  
  exportInventoryToCsv(): void {
    const dataToExport = this.sortedInventory();
    if (dataToExport.length === 0) return;

    const headers = ['Material', 'MaterialDescription', 'TotalIn', 'TotalOut', 'Balance', 'Unit'];
    const rows = dataToExport.map(item => {
      const description = `"${item.materialDescription.replace(/"/g, '""')}"`;
      return [
        item.material,
        description,
        item.totalIn,
        item.totalOut,
        item.balance,
        item.unit
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const date = new Date().toISOString().split('T')[0];
    link.setAttribute("download", `inventory_export_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  exportToCsv(): void {
    const details = this.detailedTransactionsView();
    if (!details || details.transactions.length === 0) return;

    const headers = ['PostingDate', 'Quantity', 'User', 'CostCenter', 'Document', 'Reservation', 'HeaderText', 'Text'];
    
    const rows = details.transactions.map(tx => {
      const quantity = details.type === 'in' ? tx.quantity : -tx.quantity;
      const safe = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;

      return [
        tx.postingDate,
        quantity,
        safe(tx.user),
        safe(tx.costCenter),
        safe(tx.document),
        safe(tx.reservation),
        safe(tx.headerText),
        safe(tx.text)
      ].join(',');
    });
    
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.setAttribute("href", url);
    const materialId = this.selectedMaterial()?.material || 'export';
    link.setAttribute("download", `${materialId}_${details.type}_transactions.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private processData(response: InventoryResponse): MaterialSummary[] {
    const { headers, rows } = response;
    const required = ['Material', 'Material Description', 'Quantity', 'Unit of Entry', 'Movement Type'];
    const indices = Object.fromEntries(required.map(h => [h, headers.indexOf(h)]));

    if (Object.values(indices).some(i => i === -1)) {
      throw new Error(`Data format is incorrect. Missing columns. Required: ${required.join(', ')}.`);
    }
    
    const userIndex = headers.indexOf('User Name');
    const postingDateIndex = headers.indexOf('Posting Date');
    const costCenterIndex = headers.indexOf('Cost Center');
    const reservationIndex = headers.indexOf('Reservation');
    const docIndex = headers.indexOf('Material Document');
    const headerTextIndex = headers.indexOf('Document Header Text');
    const textIndex = headers.indexOf('Text');

    const summaryMap = new Map<string, Omit<MaterialSummary, 'material'>>();
    const allowedMovements = new Set(['101', '201']);
    
    for (const row of rows) {
      const movementType = (row[indices['Movement Type']] as string)?.trim();
      if (!allowedMovements.has(movementType)) continue;

      const material = row[indices['Material']] as string;
      const quantity = Number(row[indices['Quantity']]);
      if (!material || isNaN(quantity)) continue;
      
      if (!summaryMap.has(material)) {
        summaryMap.set(material, {
          materialDescription: (row[indices['Material Description']] as string) || 'No Description',
          totalIn: 0, totalOut: 0, balance: 0,
          unit: (row[indices['Unit of Entry']] as string) || 'N/A',
          inTransactions: [], outTransactions: []
        });
      }

      const current = summaryMap.get(material)!;
      const costCenterCode = (row[costCenterIndex] as string) || '';
      const transaction: Transaction = {
        postingDate: row[postingDateIndex] as string,
        quantity: Math.abs(quantity),
        user: (row[userIndex] as string) || '',
        costCenter: costCenterMap[costCenterCode.trim()] || costCenterCode,
        reservation: (row[reservationIndex] as string) || '',
        document: (row[docIndex] as string) || '',
        headerText: (row[headerTextIndex] as string) || '',
        text: (row[textIndex] as string) || '',
      };

      if (movementType === '101') {
        current.totalIn += quantity;
        current.inTransactions.push(transaction);
      } else if (movementType === '201') {
        current.totalOut += Math.abs(quantity);
        current.outTransactions.push(transaction);
      }
    }
    
    return Array.from(summaryMap.entries()).map(([key, value]) => {
      value.balance = value.totalIn - value.totalOut;
      value.inTransactions.sort((a,b) => new Date(b.postingDate).getTime() - new Date(a.postingDate).getTime());
      value.outTransactions.sort((a,b) => new Date(b.postingDate).getTime() - new Date(a.postingDate).getTime());
      return { material: key, ...value };
    });
  }
}
