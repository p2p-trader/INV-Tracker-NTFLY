import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
// Fix: Consolidate RxJS imports, use 'rxjs' root, and remove unused 'of' operator.
import { Observable, catchError } from 'rxjs';
import { InventoryResponse } from '../models/inventory.model';

@Injectable({
  providedIn: 'root'
})
export class InventoryService {
  // Fix: Explicitly type `http` as `HttpClient` to resolve a TypeScript inference issue where it was being typed as `unknown`.
  private http: HttpClient = inject(HttpClient);
  
  // The provided Google Apps Script URL
  private apiUrl = 'https://script.google.com/macros/s/AKfycbwzkpT1rY9O-vlVZ-p4EuozhX8aUoc0_3w3ZPd-NFzNkShrX3CgJJpf0vafQHgNJzNz/exec';

  getInventoryData(): Observable<InventoryResponse> {
    return this.http.get<InventoryResponse>(this.apiUrl).pipe(
      catchError(error => {
        console.error('Error fetching inventory data:', error);
        // Throw a more user-friendly error message
        throw new Error('Failed to load inventory data. Please check the API endpoint and network connection.');
      })
    );
  }
}
