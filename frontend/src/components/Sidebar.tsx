// components/Sidebar.tsx
"use client";

import React, { useState } from "react";
import { Menu, X } from "lucide-react";
import Link from "next/link";

const Sidebar = () => {
  const [isOpen, setIsOpen] = useState(false);

  const close = () => setIsOpen(false);

  return (
    <>
      {/* Κουμπί ανοίγματος – πάντα ορατό */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-4 left-4 z-[100] p-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-all duration-300"
        aria-label="Open menu"
      >
        <Menu size={24} />
      </button>

      {/* Σκοτεινό overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50"
          onClick={close}
        />
      )}

      {/* Drawer μενού */}
      <div
        className={`fixed top-0 left-0 h-full w-64 bg-gray-900 text-white transform transition-transform duration-300 ease-in-out z-50 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Sidebar menu"
      >
        {/* Header: MENU κεντραρισμένο, X δεξιά */}
        <div className="relative p-4 border-b border-gray-700">
          <div className="flex items-center justify-center">
            <h2 className="text-xl font-bold tracking-wide select-none">MENU</h2>
          </div>
          <button
            onClick={close}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-800 rounded"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="p-4">
          <ul className="space-y-2">
            <li>
              <Link
                href="/"
                className="block p-2 hover:bg-gray-800 rounded transition"
                onClick={close}
              >
                PROPS
              </Link>
            </li>

            <li>
              <Link
                href="/streaks"
                className="block p-2 hover:bg-gray-800 rounded transition"
                onClick={close}
              >
                STREAKS
              </Link>
            </li>

            <li>
              <Link
                href="/picks"
                className="block p-2 hover:bg-gray-800 rounded transition"
                onClick={close}
              >
                MY PICKS
              </Link>
            </li>

            {/* Νέο link για το Manual Bet Builder */}
            <li>
              <Link
                href="/builder"
                className="block p-2 hover:bg-gray-800 rounded transition"
                onClick={close}
              >
                BETBUILDER
              </Link>
            </li>

            <li>
              <span className="block p-2 text-gray-500 cursor-not-allowed">
                STANDINGS (soon)
              </span>
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
};

export default Sidebar;