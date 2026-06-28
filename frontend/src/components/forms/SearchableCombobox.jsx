import { useId, useMemo, useRef, useState } from "react";

function isActive(value) {
  return Boolean(value && value !== "todos");
}

function normalizeSearchText(value, formatLabel) {
  return formatLabel(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export default function SearchableCombobox({
  label,
  value,
  allLabel,
  options,
  onChange,
  formatLabel = (item) => String(item ?? ""),
  allowClear = true,
}) {
  const listId = useId();
  const rootRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const allOptions = useMemo(
    () => [{ value: "todos", label: allLabel }, ...options],
    [allLabel, options]
  );
  const visibleOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query, formatLabel);
    if (!normalizedQuery) return allOptions;
    return allOptions.filter((option) =>
      normalizeSearchText(option.label, formatLabel).includes(normalizedQuery)
    );
  }, [allOptions, formatLabel, query]);

  function selectOption(option) {
    if (!option) return;
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, visibleOptions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      selectOption(visibleOptions[activeIndex]);
    }
  }

  return (
    <label className="control-group dashboard-combobox" ref={rootRef}>
      <span className="control-label">{label}</span>
      <div
        className="dashboard-combobox-control"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="control-select dashboard-combobox-input"
          value={open ? query : formatLabel(selectedOption?.label || allLabel)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {allowClear && isActive(value) && (
          <button
            type="button"
            className="dashboard-combobox-clear"
            aria-label={`Limpiar ${label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectOption(allOptions[0])}
          >
            x
          </button>
        )}
        <button
          type="button"
          className="dashboard-combobox-toggle"
          aria-label={`Abrir ${label}`}
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setActiveIndex(0);
            setOpen((current) => !current);
          }}
        >
          ▾
        </button>
        {open && (
          <div className="dashboard-combobox-menu" id={listId} role="listbox">
            {visibleOptions.length ? (
              visibleOptions.map((option, index) => (
                <button
                  type="button"
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  className={index === activeIndex ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  {formatLabel(option.label)}
                </button>
              ))
            ) : (
              <span className="dashboard-combobox-empty">Sin coincidencias</span>
            )}
          </div>
        )}
      </div>
    </label>
  );
}
