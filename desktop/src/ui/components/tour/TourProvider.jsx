import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

const TourContext = createContext(null);

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) return { isActive: false, startTour: () => {}, endTour: () => {}, nextStep: () => {}, prevStep: () => {}, currentStep: null, stepIndex: 0, totalSteps: 0 };
  return ctx;
}

const tourRegistry = {};

export function registerTour(id, steps) {
  tourRegistry[id] = steps;
}

export function TourProvider({ children, navigate, setMyDataSection }) {
  const [isActive, setIsActive] = useState(false);
  const [tourId, setTourId] = useState(null);
  const [steps, setSteps] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const cleanupRef = useRef(null);

  const endTour = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setIsActive(false);
    setTourId(null);
    setSteps([]);
    setStepIndex(0);
  }, []);

  const runBeforeStep = useCallback(async (step) => {
    if (step.beforeStep) {
      await step.beforeStep({ navigate, setMyDataSection });
    }
  }, [navigate, setMyDataSection]);

  const goToStep = useCallback(async (idx, stepsArr) => {
    const s = stepsArr || steps;
    if (idx < 0 || idx >= s.length) {
      endTour();
      return;
    }
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    const step = s[idx];
    await runBeforeStep(step);
    setStepIndex(idx);

    // Wait for DOM element to appear (up to 3 seconds)
    if (step.target) {
      let attempts = 0;
      const waitForEl = () => new Promise((resolve) => {
        const check = () => {
          const el = document.querySelector(step.target);
          if (el) { resolve(el); return; }
          attempts++;
          if (attempts > 30) { resolve(null); return; }
          setTimeout(check, 100);
        };
        check();
      });
      await waitForEl();
    }

    // Set up advanceOn listener
    if (step.advanceOn === 'click' && step.target) {
      const setupListener = () => {
        const el = document.querySelector(step.target);
        if (!el) return;
        const handler = () => {
          setTimeout(() => {
            goToStep(idx + 1, s);
          }, 300);
        };
        el.addEventListener('click', handler, { once: true });
        cleanupRef.current = () => el.removeEventListener('click', handler);
      };
      // Small delay to let React render settle
      setTimeout(setupListener, 50);
    }
  }, [steps, endTour, runBeforeStep]);

  const startTour = useCallback(async (id) => {
    const tourSteps = tourRegistry[id];
    if (!tourSteps || tourSteps.length === 0) return;
    setTourId(id);
    setSteps(tourSteps);
    setIsActive(true);
    await goToStep(0, tourSteps);
  }, [goToStep]);

  const nextStep = useCallback(() => {
    goToStep(stepIndex + 1);
  }, [stepIndex, goToStep]);

  const prevStep = useCallback(() => {
    goToStep(stepIndex - 1);
  }, [stepIndex, goToStep]);

  const currentStep = isActive && steps[stepIndex] ? steps[stepIndex] : null;

  const value = {
    isActive,
    tourId,
    currentStep,
    stepIndex,
    totalSteps: steps.length,
    startTour,
    endTour,
    nextStep,
    prevStep,
  };

  return (
    <TourContext.Provider value={value}>
      {children}
    </TourContext.Provider>
  );
}
