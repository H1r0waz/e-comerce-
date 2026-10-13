"use client";

import { FormEvent, useMemo, useState } from "react";

type Product = {
  id: number;
  name: string;
  detail: string;
  stock: number;
  reserved: number;
  price: string;
  status: "Disponible" | "Stock bajo";
};

const initialProducts: Product[] = [
  { id: 1, name: "Sérum vitamina C", detail: "30 ml · Glow Lab", stock: 18, reserved: 2, price: "$ 24.500", status: "Disponible" },
  { id: 2, name: "Protector solar FPS 50", detail: "50 ml · Sun Care", stock: 4, reserved: 1, price: "$ 19.900", status: "Stock bajo" },
  { id: 3, name: "Perfume Floral", detail: "50 ml · Maison", stock: 12, reserved: 0, price: "$ 36.900", status: "Disponible" },
  { id: 4, name: "Base fluida", detail: "Tono 03 · Velvet", stock: 6, reserved: 1, price: "$ 18.750", status: "Disponible" },
];

export function ProductsView() {
  const [products, setProducts] = useState(initialProducts);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");

  const filteredProducts = useMemo(() => products.filter((product) =>
    `${product.name} ${product.detail}`.toLowerCase().includes(query.toLowerCase()),
  ), [products, query]);

  const addProduct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name") || "").trim();
    const price = String(values.get("price") || "").trim();
    const stock = Number(values.get("stock") || 0);
    if (!name || !price || stock < 0) return;

    setProducts((current) => [{
      id: Date.now(),
      name,
      detail: "Producto sin variante · Sin marca",
      stock,
      reserved: 0,
      price: `$ ${price}`,
      status: stock <= 5 ? "Stock bajo" : "Disponible",
    }, ...current]);
    setShowForm(false);
    setNotice(`${name} se agregó al catálogo.`);
  };

  return (
    <section className="module-page">
      <header className="module-heading">
        <div><span className="eyebrow">CATÁLOGO</span><h2>Productos</h2><p>Gestioná variantes, precios y disponibilidad.</p></div>
        <button className="new-order" onClick={() => setShowForm(true)}>+ Agregar producto</button>
      </header>
      <div className="module-toolbar"><label className="search-input">Buscar producto<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, marca o variante" /></label><button className="secondary-button" onClick={() => setQuery("")}>Limpiar filtro</button></div>
      <article className="panel catalog-panel">
        <div className="catalog-head"><span>PRODUCTO</span><span>DISPONIBLE</span><span>RESERVADO</span><span>PRECIO</span><span>ESTADO</span></div>
        {filteredProducts.map((product) => <div className="catalog-row" key={product.id}>
          <span><strong>{product.name}</strong><small>{product.detail}</small></span><b>{product.stock}</b><b>{product.reserved}</b><strong>{product.price}</strong><em className={product.status === "Stock bajo" ? "status amber" : "status green"}>{product.status}</em>
        </div>)}
        {filteredProducts.length === 0 && <p className="empty-state">No encontramos productos con ese filtro.</p>}
      </article>
      {showForm && <div className="modal-backdrop" role="presentation"><form className="modal-card" onSubmit={addProduct}><button type="button" className="close-button" onClick={() => setShowForm(false)} aria-label="Cerrar">×</button><span className="eyebrow">NUEVO PRODUCTO</span><h3>Sumar al catálogo</h3><label>Nombre<input name="name" required autoFocus placeholder="Ej. Crema hidratante" /></label><label>Precio minorista<input name="price" required inputMode="numeric" placeholder="19500" /></label><label>Stock inicial<input name="stock" required type="number" min="0" defaultValue="1" /></label><p>Después podrás agregar categoría, variantes, lote y vencimiento.</p><button className="new-order" type="submit">Guardar producto</button></form></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </section>
  );
}
