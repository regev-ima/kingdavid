import React, { createContext, useContext, useState, useEffect } from 'react';

const ImpersonationContext = createContext();

export const useImpersonation = () => {
  const context = useContext(ImpersonationContext);
  if (!context) {
    throw new Error('useImpersonation must be used within ImpersonationProvider');
  }
  return context;
};

export const ImpersonationProvider = ({ children }) => {
  const [impersonatedRep, setImpersonatedRep] = useState(null);
  const [originalAdmin, setOriginalAdmin] = useState(null);

  useEffect(() => {
    // Load from localStorage on mount
    const stored = localStorage.getItem('impersonation');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setImpersonatedRep(data.impersonatedRep);
        setOriginalAdmin(data.originalAdmin);
      } catch (e) {
        localStorage.removeItem('impersonation');
      }
    }
  }, []);

  const startImpersonation = (admin, rep) => {
    const data = {
      impersonatedRep: rep,
      originalAdmin: admin
    };
    localStorage.setItem('impersonation', JSON.stringify(data));
    setImpersonatedRep(rep);
    setOriginalAdmin(admin);
  };

  const stopImpersonation = () => {
    localStorage.removeItem('impersonation');
    setImpersonatedRep(null);
    setOriginalAdmin(null);
  };

  const getEffectiveUser = (currentUser) => {
    if (impersonatedRep && originalAdmin) {
      // When admin impersonates a rep, we need to surface the rep's
      // *actual* role so route gating works (a bookkeeper sees her
      // workspace, a factory user sees the factory dashboard, etc.).
      // Previously this branch coerced everything to 'user' /
      // 'factory_user', which silently downgraded bookkeepers to sales
      // reps and made the user think the role wasn't saved at all.
      const isFactoryImpersonation =
        impersonatedRep.department === 'factory' ||
        impersonatedRep.role === 'factory_user';
      const isBookkeeperImpersonation =
        impersonatedRep.department === 'bookkeeping' ||
        impersonatedRep.role === 'bookkeeper';

      const effectiveRole = isFactoryImpersonation
        ? 'factory_user'
        : isBookkeeperImpersonation
          ? 'bookkeeper'
          : 'user';

      return {
        ...impersonatedRep,
        role: effectiveRole,
        _originalRole: impersonatedRep.role,
        _isImpersonated: true,
        _originalAdmin: originalAdmin
      };
    }
    return currentUser;
  };

  return (
    <ImpersonationContext.Provider
      value={{
        impersonatedRep,
        originalAdmin,
        isImpersonating: !!impersonatedRep,
        startImpersonation,
        stopImpersonation,
        getEffectiveUser
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
};
