// Older screens use arrays for embedded to-one relations. Normalize once at the
// boundary; explicit FK names disambiguate the tenant-composite foreign keys.
export function normalizeRelations(value:any):any {
 if(Array.isArray(value))return value.map(normalizeRelations)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['customers','invoices','jobs','businesses','properties'].includes(key)&&item&&!Array.isArray(item)?[normalizeRelations(item)]:normalizeRelations(item)]))
 return value
}
