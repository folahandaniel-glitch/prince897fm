import type { FieldDef } from '@/domain/builders';

/** Renders a module's fields as accessible inputs. Used by the in-app record form and the public form. */
export function DynFields({ fields, values = {}, people = [], departments = [] }: { fields: FieldDef[]; values?: Record<string, unknown>; people?: { id: string; name: string }[]; departments?: { id: string; name: string }[] }) {
  return (
    <>
      {fields.filter((f) => !f.archived).map((f) => {
        const id = `f_${f.key}`, v = values[f.key];
        const label = <label className="label" htmlFor={id}>{f.label}{f.required && <span aria-hidden> *</span>}</label>;
        const common = { id, name: f.key, required: f.required && f.type !== 'boolean' } as const;
        let control: React.ReactNode;
        switch (f.type) {
          case 'longtext': control = <textarea {...common} rows={4} defaultValue={String(v ?? '')} className="input py-2" />; break;
          case 'select': control = <select {...common} defaultValue={String(v ?? '')} className="input"><option value="">—</option>{f.options?.map((o) => <option key={o}>{o}</option>)}</select>; break;
          case 'multiselect': control = <select {...common} multiple size={Math.min(4, f.options?.length ?? 3)} defaultValue={Array.isArray(v) ? (v as string[]) : []} className="input">{f.options?.map((o) => <option key={o}>{o}</option>)}</select>; break;
          case 'boolean': return <label key={f.key} className="mb-3 flex items-center gap-2 text-sm"><input id={id} name={f.key} type="checkbox" defaultChecked={v === true} className="h-5 w-5" /> {f.label}{f.required && <span aria-hidden> *</span>}</label>;
          case 'employee': control = <select {...common} defaultValue={String(v ?? '')} className="input"><option value="">—</option>{people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>; break;
          case 'department': control = <select {...common} defaultValue={String(v ?? '')} className="input"><option value="">—</option>{departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>; break;
          default: {
            const type = f.type === 'number' || f.type === 'currency' ? 'text' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : f.type === 'phone' ? 'tel' : f.type === 'date' ? 'date' : 'text';
            control = <input {...common} type={type} inputMode={f.type === 'number' || f.type === 'currency' ? 'decimal' : undefined} defaultValue={String(v ?? '')} className="input" />;
          }
        }
        return <div key={f.key} className="mb-3">{label}{control}{f.help && <p className="mt-1 text-xs text-muted">{f.help}</p>}</div>;
      })}
    </>
  );
}

export function showValue(f: FieldDef, v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (f.type === 'currency') return Number(v).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' });
  return String(v);
}
