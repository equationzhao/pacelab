## Python Script for: The mathematical modelling of lactate curves from graded
## incremental exercise test
## by Simon Nolte, Oliver Jan Quittmann & Volker Meden
##
## Code for fitting the data and creating Figure 1 of the paper
## Author: Volker Meden

#####preliminaries#####

import matplotlib.pyplot as plt
import matplotlib as mpl

plt.rcParams.update({'font.size': 15.})
mpl.rcParams['font.family'] = 'STIXGeneral'
mpl.rcParams['mathtext.fontset'] = 'stix'

import numpy as np

from scipy.optimize import curve_fit

fig, axs = plt.subplots(2, 1,  sharex=True)

#####define new fitting function#####

def funcnew(x, a, b, c):

    out = a * np.exp((x-b)/c)
    out[x < b]=a 
    return out

#####read data from file PXX; put in name of the desired file, e.g., P01.txt#####

xdata = np.loadtxt("P01.txt",usecols=(0))

ydata = np.loadtxt("P01.txt",usecols=(1))

#####plot measured lactate concentration as a function of power#####

axs[0].set_ylim([0,13])
axs[0].plot(xdata, ydata,'kx', mew=1, ms=8, label='measured data', zorder=10)

#####fit the new fitting function to measured data#####

poptnew, pcovnew = curve_fit(funcnew, xdata, ydata, bounds=(0, [2., 250., 100.]))

#####compute chi^2 for the new fitting function######

ypsnew=ydata-funcnew(xdata, *poptnew)

chisqnew=np.sum(ypsnew**2)

#####plot the new fitting function#####

xdense=np.linspace(0,400,101)

axs[0].plot(xdense, funcnew(xdense, *poptnew), color='#00bfc4',

         label='Eq. (3), $c_{\mathrm{La}}^{\mathrm{rest}}=$%1.2f, $P_{\mathrm{1}}=$%3.1f, $P_2=$%2.1f' % tuple(poptnew)) 

#####compute the absolut and relative standard deviation of the fitting parameters of the new fitting function#####

perrnew = np.sqrt(np.diag(pcovnew))

relerrnew=perrnew/poptnew

#####print the absolute and relative standard deviation and chi^2 of the fitting parameters of the new fitting function to the screen#####

print(perrnew)
print(relerrnew)
print(chisqnew)

#####define reference fitting function#####

def funcold(x, a, b, c):

    return a + b * np.exp(x/c)

#####fit the reference fitting function to measured data#####

poptold, pcovold = curve_fit(funcold, xdata, ydata, bounds=([0,0,0], [2.0, .2, 100.]))

#####compute chi^2 for the reference fitting function######

ypsold=ydata-funcold(xdata, *poptold)

chisqold=np.sum(ypsold**2)

#####compute the absolut and relative standard deviation of the fitting parameters of the reference fitting function#####

perrold = np.sqrt(np.diag(pcovold))

relerrold=perrold/poptold

#####print the absolute and relative standard deviation and chi^2 of the fitting parameters of the reference fitting function to the screen#####

print(perrold)
print(relerrold)
print(chisqold)

#####plot the reference fitting function#####

axs[0].plot(xdense, funcold(xdense, *poptold), '#f8766d',

         label='Eq. (1), $a=$%1.2f, $b=$%1.3f, $c=$%2.1f' % tuple(poptold))

axs[0].set_ylabel('$c_{\mathrm{La}}$ in mmol/l')

axs[0].legend(fontsize='small', framealpha=0.4).set_zorder(100)

#####compute and plot the residua of the new and reference fitting function##### 

ypsnew=(ydata-funcnew(xdata, *poptnew))

axs[1].plot(xdata, ypsnew, linestyle='', marker='+', color='#00bfc4', ms=12, label='diff. fit Eq. (3)')

ypsold=(ydata-funcold(xdata, *poptold))

axs[1].set_yticks([-0.4,-0.2,0,0.2,0.4])
axs[1].set_ylim([-0.5,0.5])
axs[1].plot(xdata, ypsold, linestyle='', marker='x', color='#f8766d', ms=10, label='diff. fit Eq. (1)')

axs[1].plot((0.0,400.0), (0.0,0.0), 'k--')

axs[1].set_xlabel('$P$ in W')

axs[1].set_ylabel('$\Delta c_{\mathrm{La}}$ in mmol/l')

axs[1].legend(fontsize='small', framealpha=0.4).set_zorder(100)

#####plot a title of the figure; put in the desired name PXX, e.g., P01#####

fig.suptitle('P01')

#####save a pdf of the figure as PXX.pdf; put in the desired name, e.g., P01.pdf#####

plt.savefig("P01.pdf")

#####plot the figure to the screen#####

plt.show()