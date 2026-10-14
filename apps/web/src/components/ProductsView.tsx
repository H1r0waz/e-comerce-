"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError } from "../lib/api/client";
import type { CatalogProduct, CreateProductInput } from "../lib/api/types";
import { useCommerceSession } from "./SessionGate";

type Modal = "product" | "stock" | null;

export function ProductsView() {
  const { api } = useCommerceSession();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void api.listProducts()
      .then((items) => { if (active) setProducts(items); })
      .catch(() => { if (active) setError("No pudimos cargar el catálogo. Probá recargar la página."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  const filteredProducts = useMemo(() => products.filter((product) =>
    `${product.name} ${product.variantName} ${product.categoryName} ${product.sku}`.toLowerCase().includes(query.toLowerCase()),
  ), [products, query]);

  const openProduct = () => { setError(""); setModal("product"); };
  const openStock = (product: CatalogProduct) => { setError(""); setSelected(product); setModal("stock"); };
  const closeModal = () => { if (!saving) { setModal(null); setSelected(null); } };

  const addProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = textValue(values, "name");
    const categoryName = textValue(values, "categoryName") || "General";
    const initialQuantity = wholeNumber(values, "initialQuantity");
    const retailPriceMinor = moneyToMinor(values, "retailPrice");
    const unitCostMinor = initialQuantity && initialQuantity > 0 ? moneyToMinor(values, "unitCost") : 0;
    if (!name || retailPriceMinor === null || initialQuantity === null || unitCostMinor === null) {
      setError("Revisá el nombre, los importes y la cantidad inicial."); return;
    }
    const input: CreateProductInput = {
      name, categoryName, variantName: textValue(values, "variantName") || undefined, sku: textValue(values, "sku") || undefined,
      retailPriceMinor, lowStockThreshold: optionalWholeNumber(values, "lowStockThreshold"), initialQuantity,
      unitCostMinor: initialQuantity > 0 ? unitCostMinor : undefined,
      lotCode: textValue(values, "lotCode") || undefined, expiresAt: textValue(values, "expiresAt") || undefined,
    };
    setSaving(true); setError("");
    try {
      const product = await api.createProduct(input);
      setProducts((current) => [product, ...current]);
      setModal(null); setNotice(`${product.name} se agregó al catálogo.`);
    } catch (reason) { setError(messageFor(reason, "No pudimos guardar el producto.")); }
    finally { setSaving(false); }
  };

  const receiveStock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const values = new FormData(event.currentTarget);
    const quantity = wholeNumber(values, "quantity");
    const unitCostMinor = moneyToMinor(values, "unitCost");
    if (!quantity || quantity < 1 || unitCostMinor === null) { setError("Ingresá una cantidad y un costo válidos."); return; }
    setSaving(true); setError("");
    try {
      const updated = await api.receiveStock({
        variantId: selected.variantId, quantity, unitCostMinor,
        lotCode: textValue(values, "lotCode") || undefined, expiresAt: textValue(values, "expiresAt") || undefined,
      });
      setProducts((current) => current.map((product) => product.variantId === updated.variantId ? updated : product));
      setModal(null); setSelected(null); setNotice(`Registraste ${quantity} unidades de ${updated.name}.`);
    } catch (reason) { setError(messageFor(reason, "No pudimos registrar el ingreso de stock.")); }
    finally { setSaving(false); }
  };

  return <section className="module-page">
    <header className="module-heading"><div><span className="eyebrow">CATÁLOGO E INVENTARIO</span><h2>Productos</h2><p>Creá productos, registrá costos y controlá el stock disponible.</p></div><button className="new-order" onClick={openProduct}>+ Agregar producto</button></header>
    <div className="module-toolbar"><label className="search-input">Buscar producto<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, categoría, SKU o variante" /></label><button className="secondary-button" onClick={() => setQuery("")}>Limpiar filtro</button></div>
    {error && !modal && <p className="dashboard-error" role="alert">{error}</p>}
    <article className="panel catalog-panel"><div className="catalog-head"><span>PRODUCTO</span><span>DISPONIBLE</span><span>RESERVADO</span><span>PRECIO</span><span>ESTADO</span><span/></div>
      {filteredProducts.map((product) => {
        const low = product.lowStockThreshold !== undefined && product.availableQuantity <= product.lowStockThreshold;
        return <div className="catalog-row" key={product.variantId}><span><strong>{product.name}</strong><small>{product.categoryName} · {product.variantName === "Única" ? "Sin variante" : product.variantName} · {product.sku}</small></span><b>{product.availableQuantity}</b><b>{product.reservedQuantity}</b><strong>{formatMoney(product.retailPriceMinor)}</strong><em className={low ? "status amber" : "status green"}>{low ? "Stock bajo" : "Disponible"}</em><button className="secondary-button stock-button" onClick={() => openStock(product)}>Ingresar stock</button></div>;
      })}
      {!loading && filteredProducts.length === 0 && <p className="empty-state">Todavía no hay productos. Agregá el primero para empezar a controlar stock y ventas.</p>}
      {loading && <p className="empty-state">Cargando catálogo…</p>}
    </article>

    {modal === "product" && <div className="modal-backdrop" role="presentation"><form className="modal-card wide-modal" onSubmit={addProduct}><button type="button" className="close-button" onClick={closeModal} aria-label="Cerrar">×</button><span className="eyebrow">NUEVO PRODUCTO</span><h3>Sumar al catálogo</h3><div className="form-grid"><label>Nombre<input name="name" required autoFocus placeholder="Ej. Crema hidratante" /></label><label>Categoría<input name="categoryName" required defaultValue="General" placeholder="Ej. Cremas" /></label><label>Variante <small>opcional</small><input name="variantName" placeholder="Ej. 50 ml" /></label><label>SKU <small>opcional</small><input name="sku" placeholder="Se genera si lo dejás vacío" /></label><label>Precio de venta<input name="retailPrice" required inputMode="decimal" placeholder="19500" /></label><label>Stock bajo desde<input name="lowStockThreshold" type="number" min="0" placeholder="Ej. 5" /></label></div><div className="form-divider"><span>Stock inicial</span><small>Podés dejarlo en 0 y cargarlo después.</small></div><div className="form-grid"><label>Cantidad<input name="initialQuantity" type="number" min="0" defaultValue="0" required /></label><label>Costo por unidad<input name="unitCost" inputMode="decimal" placeholder="Ej. 8200" /></label><label>Lote <small>opcional</small><input name="lotCode" placeholder="Ej. L-1024" /></label><label>Vencimiento <small>opcional</small><input name="expiresAt" type="date" /></label></div>{error && <p className="auth-error" role="alert">{error}</p>}<button className="new-order" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar producto"}</button></form></div>}

    {modal === "stock" && selected && <div className="modal-backdrop" role="presentation"><form className="modal-card" onSubmit={receiveStock}><button type="button" className="close-button" onClick={closeModal} aria-label="Cerrar">×</button><span className="eyebrow">INGRESO DE STOCK</span><h3>{selected.name}</h3><p>{selected.variantName === "Única" ? "Producto sin variantes" : selected.variantName} · Disponible: {selected.availableQuantity}</p><label>Cantidad ingresada<input name="quantity" type="number" min="1" required autoFocus /></label><label>Costo por unidad<input name="unitCost" inputMode="decimal" required placeholder="Ej. 8200" /></label><label>Lote <small>opcional</small><input name="lotCode" placeholder="Ej. L-1024" /></label><label>Vencimiento <small>opcional</small><input name="expiresAt" type="date" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="new-order" type="submit" disabled={saving}>{saving ? "Registrando…" : "Registrar ingreso"}</button></form></div>}
    {notice && <div className="toast" role="status">{notice}</div>}
  </section>;
}

function textValue(values: FormData, key: string): string { return String(values.get(key) ?? "").trim(); }
function wholeNumber(values: FormData, key: string): number | null { const value = Number(textValue(values, key)); return Number.isInteger(value) && value >= 0 ? value : null; }
function optionalWholeNumber(values: FormData, key: string): number | undefined { const value = textValue(values, key); if (!value) return undefined; const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : undefined; }
function moneyToMinor(values: FormData, key: string): number | null { const value = Number(textValue(values, key).replace(",", ".")); return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null; }
function formatMoney(value: number): string { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value / 100); }
function messageFor(reason: unknown, fallback: string): string { return reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : fallback; }
