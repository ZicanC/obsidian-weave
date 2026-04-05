<script lang="ts">
  import { onMount } from "svelte";
  import CategoryFilter, { type DeckFilter } from "../deck-views/CategoryFilter.svelte";
  import ViewSwitcher, { type ViewType } from "../deck-views/ViewSwitcher.svelte";

  let currentPage = $state("deck-study");
  let selectedFilter = $state<DeckFilter>("memory");
  let cardView = $state<ViewType>("table");

  function handleFilterSelect(filter: DeckFilter) {
    window.dispatchEvent(new CustomEvent("Weave:sidebar-filter-select", { detail: filter }));
  }

  function handleCardViewChange(view: ViewType) {
    window.dispatchEvent(new CustomEvent("Weave:sidebar-view-change", { detail: view }));
  }

  onMount(() => {
    const handlePageChange = (event: Event) => {
      const page = (event as CustomEvent<string>).detail;
      if (typeof page === "string") {
        currentPage = page;
      }
    };

    const handleDeckFilterChange = (event: Event) => {
      const filter = (event as CustomEvent<DeckFilter>).detail;
      if (typeof filter === "string") {
        selectedFilter = filter;
      }
    };

    const handleCardViewChangeEvent = (event: Event) => {
      const view = (event as CustomEvent<ViewType>).detail;
      if (view === "table" || view === "grid" || view === "kanban") {
        cardView = view;
      }
    };

    window.addEventListener("Weave:page-changed", handlePageChange as EventListener);
    window.addEventListener("Weave:deck-filter-change", handleDeckFilterChange as EventListener);
    window.addEventListener("Weave:card-view-change", handleCardViewChangeEvent as EventListener);

    return () => {
      window.removeEventListener("Weave:page-changed", handlePageChange as EventListener);
      window.removeEventListener("Weave:deck-filter-change", handleDeckFilterChange as EventListener);
      window.removeEventListener("Weave:card-view-change", handleCardViewChangeEvent as EventListener);
    };
  });
</script>

<div
  class="weave-mobile-header-center"
  class:is-visible={currentPage === "deck-study" || currentPage === "weave-card-management"}
>
  {#if currentPage === "deck-study"}
    <CategoryFilter {selectedFilter} onSelect={handleFilterSelect} />
  {:else if currentPage === "weave-card-management"}
    <ViewSwitcher currentView={cardView} onViewChange={handleCardViewChange} />
  {/if}
</div>

<style>
  :global(body.is-mobile .workspace-leaf-content[data-type="weave-view"][data-weave-mobile-native-header="true"] .view-header),
  :global(body.is-phone .workspace-leaf-content[data-type="weave-view"][data-weave-mobile-native-header="true"] .view-header) {
    position: relative;
  }

  :global(body.is-mobile .workspace-leaf-content[data-type="weave-view"][data-weave-mobile-native-header="true"] .weave-mobile-header-center-host),
  :global(body.is-phone .workspace-leaf-content[data-type="weave-view"][data-weave-mobile-native-header="true"] .weave-mobile-header-center-host) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 1;
    max-width: calc(100% - 168px);
  }

  .weave-mobile-header-center {
    display: none;
    align-items: center;
    justify-content: center;
    min-width: 0;
    max-width: 100%;
    pointer-events: auto;
  }

  .weave-mobile-header-center.is-visible {
    display: flex;
  }

  .weave-mobile-header-center :global(.category-filter),
  .weave-mobile-header-center :global(.view-switcher) {
    margin-bottom: 0;
  }
</style>
