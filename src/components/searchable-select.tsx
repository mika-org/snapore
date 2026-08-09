"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type SearchableSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  options: SearchableSelectOption[];
  name?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  ariaLabel?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  onValueChange?: (value: string) => void;
};

export function SearchableSelect({
  options,
  name,
  value,
  defaultValue = "",
  placeholder = "Pilih opsi",
  searchPlaceholder = "Cari opsi...",
  emptyMessage = "Opsi tidak ditemukan",
  ariaLabel,
  disabled = false,
  required = false,
  className = "",
  onValueChange,
}: SearchableSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedValue = controlled ? value : internalValue;
  const selectedOption = options.find((option) => option.value === selectedValue);
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("id-ID");
    return normalized
      ? options.filter((option) => option.label.toLocaleLowerCase("id-ID").includes(normalized))
      : options;
  }, [options, query]);
  const selectableOptions = filteredOptions.filter((option) => !option.disabled);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    if (controlled) return;
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const reset = () => {
      setInternalValue(defaultValue);
      setOpen(false);
      setQuery("");
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [controlled, defaultValue]);

  const choose = (option: SearchableSelectOption) => {
    if (option.disabled) return;
    if (!controlled) setInternalValue(option.value);
    onValueChange?.(option.value);
    setOpen(false);
    setQuery("");
  };

  const handleSearchKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => selectableOptions.length ? (current + direction + selectableOptions.length) % selectableOptions.length : 0);
      return;
    }
    if (event.key === "Enter" && selectableOptions[activeIndex]) {
      event.preventDefault();
      choose(selectableOptions[activeIndex]);
    }
  };

  return (
    <div className={`searchable-select ${open ? "open" : ""} ${disabled ? "disabled" : ""} ${className}`.trim()} ref={rootRef}>
      <button
        className="searchable-select-trigger"
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-required={required}
        disabled={disabled}
        onClick={() => { setActiveIndex(0); setOpen((current) => !current); }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            setActiveIndex(0);
            setOpen(true);
          }
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <span className={!selectedOption ? "placeholder" : ""}>{selectedOption?.label ?? placeholder}</span>
        <ChevronDown size={15} />
      </button>
      {name ? <input className="searchable-select-form-value" type="text" name={name} value={selectedValue} required={required} disabled={disabled} tabIndex={-1} autoComplete="off" aria-hidden="true" onChange={() => undefined} onInvalid={(event) => { event.preventDefault(); setActiveIndex(0); setOpen(true); }} /> : null}
      {open ? (
        <div className="searchable-select-popover">
          <div className="searchable-select-search"><Search size={14} /><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={handleSearchKeys} placeholder={searchPlaceholder} aria-label={searchPlaceholder} /><button type="button" onClick={() => { setQuery(""); setActiveIndex(0); }} aria-label="Hapus pencarian"><X size={13} /></button></div>
          <div className="searchable-select-options" id={listId} role="listbox">
            {filteredOptions.map((option) => {
              const selectableIndex = selectableOptions.findIndex((item) => item.value === option.value);
              return <button className={selectableIndex === activeIndex ? "active" : ""} type="button" role="option" aria-selected={option.value === selectedValue} disabled={option.disabled} key={option.value || "__empty"} onMouseEnter={() => { if (selectableIndex >= 0) setActiveIndex(selectableIndex); }} onClick={() => choose(option)}><span>{option.label}</span>{option.value === selectedValue ? <Check size={14} /> : null}</button>;
            })}
            {filteredOptions.length === 0 ? <p>{emptyMessage}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
